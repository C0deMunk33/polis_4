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
      var passesEl = $('passes'); if (passesEl) { passesEl.textContent = ''; (passes||[]).map(renderPass).forEach(function(n){ passesEl.appendChild(n); }); if(!passes || passes.length===0) passesEl.innerHTML = '<em class="muted">No passes yet</em>'; }
      var roomsList = $('roomsList'); if (roomsList) roomsList.innerHTML = '<ul class="muted">' + (rooms||[]).map(function(r){ return '<li>'+esc(r)+'</li>'; }).join('') + '</ul>';
      var agentSelEl = $('agents');
      if (agentSelEl) {
        agentSelEl.innerHTML = '<option value="">All agents</option>' + (agents||[]).map(function(a){
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
      (snaps||[]).forEach(function(s){
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
      if ((snaps||[]).length > 0) {
        Array.from(grid.querySelectorAll('em')).forEach(function(el){
          try { if (el.parentNode === grid) grid.removeChild(el); } catch(e){}
        });
      }
      (snaps||[]).forEach(function(s){
        names[s.name]=true;
        if (!roomState[s.name]) roomState[s.name] = { lastChatTs: 0 };
        var existing = $('room-'+s.name);
        if (!existing) {
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
          // Initial chat load for the new room
          fetchJSON('/api/room-chat?room='+encodeURIComponent(s.name)).then(function(msgs){
            var chatEl = $('chat-'+s.name); var pre = chatEl ? chatEl.querySelector('pre') : null;
            if (pre) pre.textContent = (msgs||[]).map(function(m){ roomState[s.name].lastChatTs = Math.max(roomState[s.name].lastChatTs, Number(m.timestamp)||0); return '['+new Date(m.timestamp).toLocaleTimeString()+'] '+m.handle+' (#'+m.agentId+'): '+m.content; }).join('\n') || 'No messages';
          });
        }
        updateRoomCard(s);
      });
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
          var lines = existing.split('\n');
          if (lines.length > 20) lines = lines.slice(-20);
          pre.textContent = lines.join('\n');
        }).catch(function(){});
      });
    }).catch(function(){});
  }

  // Agents
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
    // Persona from latest pass preResults 'self:' line
    fetchJSON('/api/passes?agentId='+encodeURIComponent(selectedAgentId)+'&limit=1').then(function(latest){
      var selfBlock = '';
      try {
        var pre = (latest && latest[0] && latest[0].preResults) || '';
        var idx = pre.indexOf('- self:');
        if (idx >= 0) {
          selfBlock = pre.slice(idx + 7).trim();
        }
      } catch(e) {}
      if ($('agentSelf')) $('agentSelf').textContent = selfBlock || '(no self data yet)';
    }).catch(function(){ if ($('agentSelf')) $('agentSelf').textContent = '(no self data yet)'; });
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
      try {
        var stateObj = item ? JSON.parse(item.stateJson||'{}') : {};
        if ($('itemState')) $('itemState').textContent = JSON.stringify(stateObj, null, 2) || '{}';
      } catch(e) { if ($('itemState')) $('itemState').textContent = '{}'; }
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
    if(current==='dashboard') {
      var auto = document.getElementById('autorefresh');
      if (!auto || (auto && auto.checked)) { renderDashboard(); }
    }
    if(current==='rooms') tickRooms();
    if(current==='agents') renderAgents();
    if(current==='items') renderItems();
  }, 3000);
  var refreshBtn = document.getElementById('refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', function(){ renderDashboard(); });
})();
