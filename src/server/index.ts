import 'dotenv/config';
import express, { Request, Response } from 'express';
import { PolisDB } from '../lib/db';
import { Polis } from '../lib/polis';
import bodyParser from 'express';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const db = new PolisDB(process.env.POLIS_DB || 'polis.sqlite3');
const polis = new Polis(db);

type RoomEvent = { timestamp: number; type: 'chat' | 'item' | 'interact' | 'join' | 'leave' | 'createRoom'; text: string; agentId: string };
type RoomSnapshot = { name: string; isPrivate?: boolean; participants: { agentId: string; handle?: string }[]; items: { name: string; ownerId: string }[]; events: RoomEvent[] };

function buildRoomSnapshotsFromDB(limitPasses: number = 400): RoomSnapshot[] {
  const recent = db.listRecent(limitPasses);
  const passes = [...recent].reverse(); // oldest to newest
  const agentRoom: Record<string, string | undefined> = {};
  const rooms: Record<string, RoomSnapshot> = {};

  const getRoom = (name: string): RoomSnapshot => {
    if (!rooms[name]) rooms[name] = { name, participants: [], items: [], events: [] };
    return rooms[name];
  };

  const ensureParticipant = (room: RoomSnapshot, agentId: string, handle?: string) => {
    if (!room.participants.some(p => p.agentId === agentId)) room.participants.push({ agentId, handle });
  };

  for (const p of passes) {
    const ts = Number(p.timestamp) || Date.now();
    let execs: string[] = [];
    try { execs = JSON.parse(p.executionsJson) as string[]; } catch {}

    // Track room joins
    for (const e of execs) {
      const right = e.split('->')[1]?.trim() || '';
      const joined = right.match(/^Joined room (.+)$/);
      const accepted = right.match(/^Accepted invite and joined (.+)$/);
      const returned = right.match(/^Returned to directory$/);
      const left = right.match(/^Left room (.+)$/);
      const created = right.match(/^Created room (.+) \((private|public)\)$/);
      if (joined) {
        agentRoom[p.agentId] = joined[1];
        getRoom(joined[1]).events.push({ timestamp: ts, type: 'join', text: `${p.agentId} joined`, agentId: p.agentId });
      } else if (accepted) {
        agentRoom[p.agentId] = accepted[1];
        getRoom(accepted[1]).events.push({ timestamp: ts, type: 'join', text: `${p.agentId} accepted invite`, agentId: p.agentId });
      } else if (returned) {
        agentRoom[p.agentId] = undefined;
      } else if (left) {
        // Clear current room association on explicit leave
        agentRoom[p.agentId] = undefined;
        getRoom(left[1]).events.push({ timestamp: ts, type: 'leave', text: `${p.agentId} left`, agentId: p.agentId });
      } else if (created) {
        const r = getRoom(created[1]);
        r.isPrivate = created[2] === 'private';
        r.events.push({ timestamp: ts, type: 'createRoom', text: right, agentId: p.agentId });
      }
    }

    const currentRoom = agentRoom[p.agentId];
    if (!currentRoom) {
      // We still might learn rooms list from preResults (rooms: ...)
      if (p.preResults && p.preResults.includes('- rooms:')) {
        const lines = p.preResults.split('\n').map(s => s.trim());
        for (const line of lines) {
          const m = line.match(/^(.*) \((private|public)\)$/);
          if (m) {
            const r = getRoom(m[1]);
            r.isPrivate = m[2] === 'private';
          }
        }
      }
      continue;
    }

    const room = getRoom(currentRoom);

    // Participants from preResults who:
    if (p.preResults && p.preResults.includes('- who:')) {
      const after = p.preResults.split('- who:')[1] || '';
      const lines = after.split('\n').map(s => s.trim()).filter(Boolean);
      for (const ln of lines) {
        const mm = ln.match(/^(.+) \(#([^\)]+)\)/);
        if (mm) ensureParticipant(room, mm[2], mm[1]);
      }
    }

    // Events parsing
    for (const e of execs) {
      const right = e.split('->')[1]?.trim() || '';
      if (/^Message posted by /.test(right)) {
        room.events.push({ timestamp: ts, type: 'chat', text: right, agentId: p.agentId });
        ensureParticipant(room, p.agentId);
      }
      const createdItem = right.match(/^Created item '([^']+)' \(owner:#([^\)]+)\)/);
      if (createdItem) {
        room.items.push({ name: createdItem[1], ownerId: createdItem[2] });
        room.events.push({ timestamp: ts, type: 'item', text: right, agentId: p.agentId });
      }
      const interacted = right.match(/^Interaction '([^']+)' completed on (.+)$/);
      if (interacted) {
        room.events.push({ timestamp: ts, type: 'interact', text: right, agentId: p.agentId });
      }
    }
  }

  // Fallback: ensure rooms discovered from chat messages exist even if no passes indicate them
  try {
    const chatRooms = db.listChatRooms();
    for (const cr of chatRooms as any[]) {
      if (!rooms[cr.room]) {
        rooms[cr.room] = { name: cr.room, participants: [], items: [], events: [] } as RoomSnapshot;
      }
    }
  } catch {}

  // Also include explicitly persisted rooms
  try {
    const persisted = db.listPersistedRooms();
    for (const r of persisted as any[]) {
      if (!rooms[r.name]) {
        rooms[r.name] = { name: r.name, isPrivate: !!r.isPrivate, participants: [], items: [], events: [] } as RoomSnapshot;
      } else {
        rooms[r.name].isPrivate = !!r.isPrivate;
      }
    }
  } catch {}

  // Keep only latest few events per room
  for (const r of Object.values(rooms)) {
    r.events.sort((a, b) => b.timestamp - a.timestamp);
    r.events = r.events.slice(0, 10);
  }

  return Object.values(rooms);
}

// Serve the app CSS and JS to implement a simple SPA with tabs
const APP_CSS = `
:root { --bg:#0b0d10; --card:#12161b; --muted:#8aa0b3; --text:#e6edf3; --accent:#5aa2ff; --border:#22303c; }
*{box-sizing:border-box}
body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial; background:var(--bg); color:var(--text); }
header { padding:16px 20px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
nav { display:flex; gap:8px; }
nav button { background:transparent; color:var(--text); border:1px solid var(--border); padding:8px 12px; border-radius:6px; cursor:pointer; }
nav button.active { background:var(--accent); color:#06121f; border-color:var(--accent); }
main { padding:20px; }
.row { display:flex; gap:16px; align-items:flex-start; }
.card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:12px; }
.muted { color: var(--muted); }
pre { white-space: pre-wrap; word-break: break-word; }
.grid { display:grid; grid-template-columns: repeat(auto-fill,minmax(340px,1fr)); gap:16px; }
label { font-size:14px; }
input, select { background:#0f141a; color:var(--text); border:1px solid var(--border); border-radius:6px; padding:6px 8px; }
input[type="text"], input[type="number"] { min-width: 120px; }
button.primary { background:var(--accent); color:#06121f; border:1px solid var(--accent); border-radius:6px; padding:8px 12px; cursor:pointer; }
.agent-link { background:transparent; color:var(--text); border:1px solid var(--border); border-radius:6px; padding:6px 8px; width:100%; text-align:left; cursor:pointer; }
.agent-link.active { background:var(--accent); color:#06121f; border-color:var(--accent); }
`;

const APP_JS = `
(function(){
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
  function fetchJSON(path){ return fetch(path).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }); }

  // Tabs
  var tabs = ['dashboard','rooms','agents','items'];
  function showTab(name){
    tabs.forEach(function(t){ var btn=$('tabbtn-'+t), el=$('tab-'+t); if(btn) btn.classList.toggle('active', t===name); if(el) el.style.display = (t===name?'block':'none'); });
    if (name==='dashboard') renderDashboard();
    if (name==='rooms') ensureRoomsInitialized();
    if (name==='agents') renderAgents();
    if (name==='items') renderItems();
    history.replaceState(null,'','#'+name);
  }

  // Dashboard
  function renderPass(p){
    var tools = ''; try { tools = JSON.parse(p.toolCallsJson).map(function(t){return t.name;}).join(', ');} catch(e){}
    var execs = ''; try { execs = JSON.parse(p.executionsJson).join('\n    ');} catch(e){}
    var mb = '';
    try { if (p.messageBufferJson) { mb = JSON.stringify(JSON.parse(p.messageBufferJson), null, 2); } } catch(e){}
    var div = document.createElement('div');
    div.className = 'card';
    div.style.marginBottom = '10px';
    div.innerHTML = '<div><strong>' + new Date(p.timestamp).toLocaleTimeString() + '</strong> — <code>' + esc(p.agentId) + '</code></div>'
      + '<div>Intent: ' + esc(p.intent) + '</div>'
      + '<div class="muted">Thoughts: ' + esc(p.agentThoughts) + '</div>'
      + '<div>Tools: ' + esc(tools || '(none)') + '</div>'
      + '<details><summary>Executions</summary><pre>' + esc(execs) + '</pre></details>'
      + (mb ? ('<details><summary>Message buffer</summary><pre>' + esc(mb) + '</pre></details>') : '');
    return div;
  }
  function renderDashboard(){
    var limit = Number(($('limit')||{}).value || 50);
    var agentSel = $('agents'); var agentId = agentSel ? agentSel.value : '';
    var passesUrl = '/api/passes?limit=' + encodeURIComponent(limit) + (agentId ? ('&agentId=' + encodeURIComponent(agentId)) : '');
    Promise.all([
      fetchJSON(passesUrl), fetchJSON('/api/rooms'), fetchJSON('/api/agents')
    ]).then(function(res){
      var passes=res[0], rooms=res[1], agents=res[2];
      var passesEl = $('passes'); if (passesEl) { passesEl.textContent = ''; passes.map(renderPass).forEach(function(n){ passesEl.appendChild(n); }); if(!passes || passes.length===0) passesEl.innerHTML = '<em class="muted">No passes yet</em>'; }
      var roomsList = $('roomsList'); if (roomsList) roomsList.innerHTML = '<ul class="muted">' + rooms.map(function(r){ return '<li>'+esc(r)+'</li>'; }).join('') + '</ul>';
      var agentSelEl = $('agents');
      if (agentSelEl) {
        agentSelEl.innerHTML = '<option value="">All agents</option>' + agents.map(function(a){
          var last = new Date(a.lastTimestamp).toLocaleTimeString();
          return '<option value="' + esc(a.agentId) + '">' + esc(a.agentId) + ' (' + last + ')</option>';
        }).join('');
      }
    }).catch(function(e){ if ($('passes')) $('passes').innerHTML = '<pre>'+esc(e)+'</pre>'; });
  }

  // Rooms (vanilla incremental)
  var roomsInit = false;
  var roomState = {}; // name -> { lastChatTs }

  function ensureRoomsInitialized(){
    if (roomsInit) return;
    roomsInit = true;
    // First render of all cards
    fetchJSON('/api/room-snapshots').then(function(snaps){
      var grid = $('roomsGrid'); if (!grid) return;
      grid.textContent = '';
      if (!snaps || snaps.length===0) { grid.innerHTML = '<em class="muted">No rooms</em>'; return; }
      snaps.forEach(function(s){
        roomState[s.name] = { lastChatTs: 0 };
        var card = document.createElement('div');
        card.className = 'card';
        card.id = 'room-'+s.name;
        card.setAttribute('data-room', s.name);
        card.innerHTML = ''
          + '<h3>'+esc(s.name)+' '+(s.isPrivate?'(private)':'(public)')+'</h3>'
          + '<div class="muted participants">Participants (0): —</div>'
          + '<div>Items: <span class="items">—</span></div>'
          + '<details class="activity" style="margin-top:8px" open><summary>Recent activity</summary><pre>Loading…</pre></details>'
          + '<details style="margin-top:8px" open id="chat-'+esc(s.name)+'"><summary>Recent chat</summary><pre>Loading…</pre></details>'
          + '<form data-room="'+esc(s.name)+'" class="room-form" style="margin-top:8px; display:flex; gap:8px; align-items:center;">'
          + '  <input type="text" name="handle" value="Admin" placeholder="Admin handle" />'
          + '  <input type="text" name="content" placeholder="Say something…" style="flex:1;" />'
          + '  <button class="primary" type="submit">Send</button>'
          + '</form>';
        grid.appendChild(card);
        wireRoomForm(card);
        // Initial fill
        updateRoomCard(s);
        // Initial chat load
        fetchJSON('/api/room-chat?room='+encodeURIComponent(s.name)).then(function(msgs){
          var chatEl = $('chat-'+s.name); var pre = chatEl ? chatEl.querySelector('pre') : null;
          if (pre) pre.textContent = (msgs||[]).map(function(m){ roomState[s.name].lastChatTs = Math.max(roomState[s.name].lastChatTs, Number(m.timestamp)||0); return '['+new Date(m.timestamp).toLocaleTimeString()+'] '+m.handle+' (#'+m.agentId+'): '+m.content; }).join('\n') || 'No messages';
        });
      });
    });
  }

  function wireRoomForm(card){
    var f = card.querySelector('form.room-form');
    if (!f) return;
    f.addEventListener('submit', function(e){
      e.preventDefault();
      var fd = new FormData(f);
      var room = f.getAttribute('data-room');
      fd.append('room', room||'');
      var params = new URLSearchParams();
      fd.forEach(function(value, key){ params.append(key, String(value)); });
      fetch('/rooms/chat', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body: params.toString() })
        .then(function(){
          var input = f.querySelector('input[name="content"]'); if (input) { input.value=''; input.focus(); }
          // pull latest chat since
          var state = roomState[room||'']; var since = state ? state.lastChatTs : 0;
          fetchJSON('/api/room-chat-since?room='+encodeURIComponent(room||'')+'&since='+encodeURIComponent(since)).then(function(msgs){
            var chatEl = $('chat-'+room); var pre = chatEl ? chatEl.querySelector('pre') : null;
            if (pre && msgs && msgs.length) {
              var existing = pre.textContent || '';
              msgs.forEach(function(m){ state.lastChatTs = Math.max(state.lastChatTs, Number(m.timestamp)||0); existing += (existing? '\n' : '') + '['+new Date(m.timestamp).toLocaleTimeString()+'] '+m.handle+' (#'+m.agentId+'): '+m.content; });
              // Trim to last 20 lines
              var lines = existing.split('\n');
              if (lines.length > 20) lines = lines.slice(-20);
              pre.textContent = lines.join('\n');
            }
          });
        });
    });
  }

  function updateRoomCard(snapshot){
    var name = snapshot.name;
    var card = $('room-'+name); if (!card) return;
    var participantsEl = card.querySelector('.participants');
    if (participantsEl) participantsEl.textContent = 'Participants ('+(snapshot.participants.length||0)+'): '+(snapshot.participants.map(function(p){return (p.handle||p.agentId)}).join(', ')||'—');
    var itemsEl = card.querySelector('.items');
    if (itemsEl) itemsEl.textContent = snapshot.items.length ? snapshot.items.map(function(it){return it.name;}).join(', ') : '—';
    var activityPre = card.querySelector('.activity pre');
    if (activityPre) activityPre.textContent = ((snapshot.events||[]).map(function(ev){ return '['+new Date(ev.timestamp).toLocaleTimeString()+'] '+ev.type.toUpperCase()+': '+ev.text; }).join('\n') || 'No recent activity');
  }

  function tickRooms(){
    var grid = $('roomsGrid'); if (!grid || !roomsInit) return;
    // Update snapshots and incremental chat
    fetchJSON('/api/room-snapshots').then(function(snaps){
      var names = {};
      (snaps||[]).forEach(function(s){ names[s.name]=true; if (!roomState[s.name]) roomState[s.name] = { lastChatTs: 0 }; updateRoomCard(s); });
      // Remove cards for rooms that no longer exist
      Array.from(grid.children).forEach(function(el){ var name = el.getAttribute && el.getAttribute('data-room'); if (name && !names[name]) grid.removeChild(el); });
      // Chat since for each room
      Object.keys(roomState).forEach(function(name){
        var since = roomState[name].lastChatTs || 0;
        fetchJSON('/api/room-chat-since?room='+encodeURIComponent(name)+'&since='+encodeURIComponent(since)).then(function(msgs){
          if (!msgs || !msgs.length) return;
          var chatEl = $('chat-'+name); var pre = chatEl ? chatEl.querySelector('pre') : null; if (!pre) return;
          var existing = pre.textContent || '';
          msgs.forEach(function(m){ roomState[name].lastChatTs = Math.max(roomState[name].lastChatTs, Number(m.timestamp)||0); existing += (existing? '\n' : '') + '['+new Date(m.timestamp).toLocaleTimeString()+'] '+m.handle+' (#'+m.agentId+'): '+m.content; });
          // Trim to last 20 lines
          var lines = existing.split('\n');
          if (lines.length > 20) lines = lines.slice(-20);
          pre.textContent = lines.join('\n');
        }).catch(function(){});
      });
    }).catch(function(){});
  }

  // Agents (unchanged)
  var selectedAgentId = '';
  function renderAgents(){
    fetchJSON('/api/agents').then(function(list){
      var items = (list||[]).map(function(a){
        var last = new Date(a.lastTimestamp).toLocaleTimeString();
        var active = a.agentId===selectedAgentId ? ' active' : '';
        return '<li style="margin:6px 0;"><button type="button" class="agent-link'+active+'" data-id="'+esc(a.agentId)+'">'+esc(a.agentId)+'</button> <span class="muted" style="margin-left:6px;">'+last+'</span></li>';
      }).join('');
      if ($('agentsPane')) $('agentsPane').innerHTML = '<ul style="list-style:none; padding-left:0; margin:0;">'+ items +'</ul>';
      if (!selectedAgentId && list && list.length>0) { selectedAgentId = list[0].agentId; }
      wireAgentClicks();
      renderAgentHistory();
    });
  }
  function wireAgentClicks(){
    var pane = $('agentsPane'); if (!pane) return;
    Array.from(pane.querySelectorAll('.agent-link')).forEach(function(btn){
      btn.addEventListener('click', function(){ selectedAgentId = String(btn.getAttribute('data-id')||''); renderAgents(); });
    });
  }
  function renderAgentHistory(){
    var limitEl = $('agentLimit'); var limit = Number(limitEl ? limitEl.value : 25);
    if (!selectedAgentId) { if ($('agentHistory')) $('agentHistory').textContent = 'Select an agent'; return; }
    if ($('agentTitle')) $('agentTitle').textContent = 'Agent — '+selectedAgentId;
    fetchJSON('/api/passes?agentId='+encodeURIComponent(selectedAgentId)+'&limit='+encodeURIComponent(limit)).then(function(list){
      if ($('agentHistory')) $('agentHistory').innerHTML = (list||[]).map(function(p){ var n = renderPass(p); return n.outerHTML; }).join('') || '<em class="muted">No passes yet</em>';
    }).catch(function(e){ if ($('agentHistory')) $('agentHistory').innerHTML = '<pre>'+esc(e)+'</pre>'; });
  }

  // Items
  var selectedItemId = 0;
  function renderItems(){
    Promise.all([fetchJSON('/api/items'), selectedItemId ? fetchJSON('/api/item-interactions?itemId='+encodeURIComponent(selectedItemId)+'&limit=10') : Promise.resolve([])])
      .then(function(res){
        var list = res[0]||[]; var interactions = res[1]||[];
        // left pane
        if ($('itemsPane')) {
          $('itemsPane').innerHTML = '<ul style="list-style:none; padding-left:0; margin:0;">' + (list.map(function(it){
            var last = it.lastTimestamp ? new Date(it.lastTimestamp).toLocaleTimeString() : '—';
            var active = it.itemId===selectedItemId ? ' active' : '';
            var label = (JSON.parse(it.templateJson||'{}').name) || ('Item #' + it.itemId);
            return '<li style="margin:6px 0;"><button type="button" class="agent-link'+active+'" data-id="'+esc(it.itemId)+'">'+esc(label)+'</button> <span class="muted" style="margin-left:6px;">'+last+'</span></li>';
          }).join('')) + '</ul>';
        }
        if (!selectedItemId && list && list.length>0) { selectedItemId = list[0].itemId; }
        wireItemClicks();
        renderItemDetail(interactions);
      });
  }
  function wireItemClicks(){
    var pane = $('itemsPane'); if (!pane) return;
    Array.from(pane.querySelectorAll('.agent-link')).forEach(function(btn){
      btn.addEventListener('click', function(){ selectedItemId = Number(btn.getAttribute('data-id')||'0'); renderItems(); });
    });
  }
  function renderItemDetail(interactions){
    if (!selectedItemId) { if ($('itemHistory')) $('itemHistory').textContent = 'Select an item'; return; }
    fetchJSON('/api/item?itemId='+encodeURIComponent(selectedItemId)).then(function(item){
      var tmpl = item ? JSON.parse(item.templateJson||'{}') : {};
      if ($('itemTitle')) $('itemTitle').textContent = 'Item — ' + (tmpl.name || ('#'+selectedItemId));
      // Render state
      try {
        var stateObj = item ? JSON.parse(item.stateJson||'{}') : {};
        if ($('itemState')) $('itemState').textContent = JSON.stringify(stateObj, null, 2) || '{}';
      } catch(e) { if ($('itemState')) $('itemState').textContent = '{}'; }
      // Render possible interactions from template
      try {
        var inters = (tmpl && Array.isArray(tmpl.interactions)) ? tmpl.interactions : [];
        var lines = inters.map(function(iv){
          var inputs = (iv.action_inputs||[]).map(function(inp){ return (inp.name_and_amount||'')+': '+(inp.type||''); }).join(', ');
          var outputs = (iv.action_outputs||[]).map(function(out){ return (out.name_and_amount||'')+': '+(out.type||''); }).join(', ');
          return '- ' + (iv.name||'') + ' — ' + (iv.description||'') + (inputs? '\n  inputs: '+inputs : '') + (outputs? '\n  outputs: '+outputs : '');
        }).join('\n');
        if ($('itemInteractions')) $('itemInteractions').textContent = lines || '(none)';
      } catch(e) { if ($('itemInteractions')) $('itemInteractions').textContent = '(none)'; }
      var historyHtml = (interactions||[]).slice(0,10).map(function(p){
        var inputs = {}; var outputs = []; var upd = {}; var full = '';
        try { inputs = JSON.parse(p.inputsJson||'{}'); } catch(e) {}
        try { outputs = JSON.parse(p.outputsJson||'[]'); } catch(e) {}
        try { upd = JSON.parse(p.updatedStateJson||'{}'); } catch(e) {}
        try { full = JSON.stringify({ interaction: p.interactionName, inputs: inputs, description: p.description||'', outputs: outputs, updated_state: upd }, null, 2); } catch(e) { full = ''; }
        return '<div class="card" style="margin-bottom:10px;"><div><strong>' + new Date(p.timestamp).toLocaleTimeString() + '</strong> — <code>' + esc(p.interactionName) + '</code></div>'
          + '<div>By: ' + esc(p.agentId) + ' in ' + esc(p.room) + '</div>'
          + '<div class="muted">' + esc(p.description || '') + '</div>'
          + '<details><summary>Inputs</summary><pre>' + esc(JSON.stringify(inputs, null, 2)) + '</pre></details>'
          + '<details><summary>Outputs</summary><pre>' + esc(JSON.stringify(outputs, null, 2)) + '</pre></details>'
          + '<details><summary>Updated State</summary><pre>' + esc(JSON.stringify(upd, null, 2)) + '</pre></details>'
          + '<details><summary>Full details</summary><pre>' + esc(full) + '</pre></details>'
          + '</div>';
      }).join('') || '<em class="muted">No interactions yet</em>';
      if ($('itemHistory')) $('itemHistory').innerHTML = historyHtml;
    }).catch(function(e){ if ($('itemHistory')) $('itemHistory').innerHTML = '<pre>'+esc(e)+'</pre>'; });
  }

  // Events
  var btns = document.querySelectorAll('[data-tab]');
  btns.forEach(function(b){ b.addEventListener('click', function(){ showTab(b.getAttribute('data-tab')); }); });
  var start = (location.hash||'#dashboard').slice(1);
  showTab(tabs.includes(start)? start : 'dashboard');

  // Periodic updates without nuking DOM
  setInterval(function(){
    var activeBtn = document.querySelector('nav button.active'); var current = activeBtn && activeBtn.dataset ? activeBtn.dataset.tab : null;
    if(current==='dashboard') renderDashboard();
    if(current==='rooms') tickRooms();
    if(current==='agents') renderAgents();
    if(current==='items') renderItems();
  }, 3000);
})();
`;

app.get('/app.js', (_req: Request, res: Response) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const distPath = path.join(__dirname, 'app.client.js');
    const srcPath = path.join(__dirname, 'app.client.js'); // compiled output will place it alongside
    let js = '';
    if (fs.existsSync(distPath)) { js = fs.readFileSync(distPath, 'utf8'); }
    else {
      // Fall back to source file during dev run before tsc copies it
      const srcAlt = path.join(__dirname, '../../src/server/app.client.js');
      js = fs.readFileSync(srcAlt, 'utf8');
    }
    res.setHeader('content-type', 'application/javascript; charset=utf-8');
    res.end(js);
  } catch (e) {
    res.setHeader('content-type', 'application/javascript; charset=utf-8');
    res.end('console.error("Failed to load app.js")');
  }
});

app.get('/app.css', (_req: Request, res: Response) => {
  res.setHeader('content-type', 'text/css; charset=utf-8');
  res.end(APP_CSS);
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get('/api/passes', (req: Request, res: Response) => {
  const limit = Number(req.query.limit || 50);
  const agentId = String(req.query.agentId || '').trim();
  if (agentId) {
    return res.json(db.listRecentByAgent(agentId, limit));
  }
  res.json(db.listRecent(limit));
});

app.get('/api/rooms', (_req: Request, res: Response) => {
  try {
    const mem = polis.listRooms();
    const persisted = db.listPersistedRooms().map((r: any) => r.name);
    const chat = db.listChatRooms().map((r: any) => r.room);
    const merged = Array.from(new Set([...(mem||[]), ...(persisted||[]), ...(chat||[])])).filter(Boolean);
    res.json(merged);
  } catch {
    res.json(polis.listRooms());
  }
});

app.get('/api/agents', (_req: Request, res: Response) => {
  res.json(db.listAgents());
});

app.get('/api/room-snapshots', (req: Request, res: Response) => {
  const limit = Number(req.query.limit || 8);
  const snaps = buildRoomSnapshotsFromDB(400);
  res.json(snaps);
});

app.get('/api/room-snapshot', (req: Request, res: Response) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const snaps = buildRoomSnapshotsFromDB(400);
  const snap = snaps.find(s => s.name === name);
  res.json(snap || null);
});

app.get('/api/room-chat', (req: Request, res: Response) => {
  const room = String(req.query.room || '').trim();
  if (!room) return res.json([]);
  res.json(db.listRecentChatByRoom(room, 20));
});

app.get('/api/room-chat-since', (req: Request, res: Response) => {
  const room = String(req.query.room || '').trim();
  const since = Number(req.query.since || 0);
  if (!room) return res.json([]);
  res.json(db.listChatByRoomSince(room, since, 200));
});

// Items API
app.get('/api/items', (_req: Request, res: Response) => {
  res.json(db.listItemsSummary());
});

app.get('/api/item', (req: Request, res: Response) => {
  const itemId = Number(req.query.itemId || 0);
  if (!itemId) return res.status(400).json({ error: 'itemId required' });
  res.json(db.getItem(itemId));
});

app.get('/api/item-interactions', (req: Request, res: Response) => {
  const itemId = Number(req.query.itemId || 0);
  const limit = Number(req.query.limit || 50);
  if (!itemId) return res.status(400).json({ error: 'itemId required' });
  res.json(db.listRecentItemInteractions(itemId, limit));
});

app.get('/', (req: Request, res: Response) => {
  const limit = Number(req.query.limit || 50);
  const activeAgentId = String(req.query.agentId || '').trim();

  const agents = db.listAgents();
  const passes = activeAgentId ? db.listRecentByAgent(activeAgentId, limit) : db.listRecent(limit);

  const esc = (s: any) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const renderPass = (p: any) => {
    let tools = '';
    try { tools = JSON.parse(p.toolCallsJson).map((t: any) => t.name).join(', '); } catch {}
    let execs = '';
    try { execs = JSON.parse(p.executionsJson).join('\n    '); } catch {}
    let mb = '';
    try { if (p.messageBufferJson) { mb = JSON.stringify(JSON.parse(p.messageBufferJson), null, 2); } } catch {}
    return `<div style="border-bottom:1px solid #eee; padding:8px 0;">
      <div><strong>${new Date(p.timestamp).toLocaleTimeString()}</strong> — <code>${esc(p.agentId)}</code></div>
      <div>Intent: ${esc(p.intent)}</div>
      <div class="muted">Thoughts: ${esc(p.agentThoughts)}</div>
      <div>Tools: ${esc(tools || '(none)')}</div>
      <details><summary>Executions</summary><pre>${esc(execs)}</pre></details>
      ${mb ? `<details><summary>Message buffer</summary><pre>${esc(mb)}</pre></details>` : ''}
    </div>`;
  };

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Polis</title>
  <link rel="stylesheet" href="/app.css" />
</head>
<body>
  <header>
    <div><strong>Polis</strong></div>
    <nav>
      <button id="tabbtn-dashboard" data-tab="dashboard" class="active">Dashboard</button>
      <button id="tabbtn-rooms" data-tab="rooms">Rooms</button>
      <button id="tabbtn-agents" data-tab="agents">Agents</button>
      <button id="tabbtn-items" data-tab="items">Items</button>
    </nav>
  </header>
  <main>
    <section id="tab-dashboard">
      <div class="row" style="gap:16px; align-items:flex-end; margin-bottom:12px;">
        <label>Pass limit: <input id="limit" type="number" value="50" min="1" max="500" /></label>
        <label>Agent: <select id="agents"></select></label>
        <button id="refresh" class="primary">Refresh</button>
        <label class="muted"><input type="checkbox" id="autorefresh" checked /> Auto-refresh</label>
      </div>
      <div class="row">
        <div class="card" style="flex:2">
          <h3>Recent Passes</h3>
          <div id="passes">Loading…</div>
        </div>
        <div class="card" style="flex:1">
          <h3>Rooms</h3>
          <div id="roomsList">Loading…</div>
        </div>
      </div>
    </section>

    <section id="tab-rooms" style="display:none;">
      <div class="grid" id="roomsGrid">Loading…</div>
    </section>

    <section id="tab-agents" style="display:none;">
      <div class="row" style="gap:16px; align-items:flex-start;">
        <div class="card" style="flex:1; min-width:260px;">
          <h3>Agents</h3>
          <div id="agentsPane" class="muted">Loading…</div>
        </div>
        <div class="card" style="flex:2;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 id="agentTitle" style="margin:0;">Agent</h3>
            <label class="muted">Limit: <input id="agentLimit" type="number" value="25" min="1" max="200" /></label>
          </div>
          <details open style="margin-top:8px;"><summary>Persona (getSelf)</summary><pre id="agentSelf" class="muted">Loading…</pre></details>
          <div id="agentHistory" style="margin-top:8px;">Select an agent</div>
        </div>
      </div>
    </section>

    <section id="tab-items" style="display:none;">
      <div class="row" style="gap:16px; align-items:flex-start;">
        <div class="card" style="flex:1; min-width:260px;">
          <h3>Items</h3>
          <div id="itemsPane" class="muted">Loading…</div>
        </div>
        <div class="card" style="flex:2;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 id="itemTitle" style="margin:0;">Item</h3>
          </div>
          <details open style="margin-top:8px;"><summary>State</summary><pre id="itemState" class="muted">Select an item</pre></details>
          <details style="margin-top:8px;" open><summary>Interactions</summary><pre id="itemInteractions" class="muted">(none)</pre></details>
          <div id="itemHistory" style="margin-top:8px;">Select an item</div>
        </div>
      </div>
    </section>
  </main>
  <script src="/app.js" defer></script>
</body>
</html>`);
});

app.get('/rooms', (_req: Request, res: Response) => {
  const snaps = buildRoomSnapshotsFromDB(400);
  const esc = (s: any) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const renderMsg = (m: any) => `[${new Date(m.timestamp).toLocaleTimeString()}] ${esc(m.handle)} (#${esc(m.agentId)}): ${esc(m.content)}`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8" /><title>Rooms</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  .room { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
  .muted { color: #666; }
  pre { white-space: pre-wrap; word-break: break-word; }
</style></head><body>
<h1>Rooms</h1>
<p class="muted">Server-rendered snapshots: participants, items, and recent chat.</p>
<div class="grid">
${snaps.map(s => `
  <div class="room">
    <h3>${esc(s.name)} ${s.isPrivate ? '(private)' : '(public)'}</h3>
    <div class="muted">Participants (${s.participants.length}): ${s.participants.map((p:any)=>esc(p.handle)).join(', ') || '—'}</div>
    <div>Items: ${s.items.length === 0 ? '—' : s.items.map((it:any)=>esc(it.name)).join(', ')}</div>
    <details style="margin-top:8px;" open><summary>Recent activity</summary>
      <pre>${(s.events||[]).map((ev:any)=>`[${new Date(ev.timestamp).toLocaleTimeString()}] ${ev.type.toUpperCase()}: ${esc(ev.text)}`).join('\n') || 'No recent activity'}</pre>
    </details>
    <details style="margin-top:8px;" open><summary>Recent chat (from DB)</summary>
      <pre>${db.listRecentChatByRoom(s.name, 12).map((m:any)=>`[${new Date(m.timestamp).toLocaleTimeString()}] ${esc(m.handle)} (#${esc(m.agentId)}): ${esc(m.content)}`).join('\n') || 'No messages'}</pre>
    </details>
    <form method="POST" action="/rooms/chat" style="margin-top:8px; display:flex; gap:8px; align-items:center;">
      <input type="hidden" name="room" value="${esc(s.name)}" />
      <input name="handle" placeholder="Admin handle" value="Admin" />
      <input name="content" placeholder="Say something…" style="flex:1;" />
      <button type="submit">Send</button>
    </form>
  </div>`).join('')}
</div>
<div style="margin-top:24px;"><a href="/">Back to Dashboard</a></div>
</body></html>`;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html);
});

app.post('/rooms/chat', (req: Request, res: Response) => {
  const room = String((req.body?.room || req.query?.room || '')).trim();
  const handle = String((req.body?.handle || 'Admin')).trim();
  const content = String((req.body?.content || '')).trim();
  if (!room || !content) {
    res.status(400).send('room and content required');
    return;
  }
  try {
    db.insertChatMessage({ timestamp: Date.now(), room, agentId: 'admin', handle, content });
  } catch {}
  res.redirect('/rooms');
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Polis server running on http://localhost:${process.env.PORT || 3000}`);
});
