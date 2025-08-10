import Database from 'better-sqlite3';

export interface AgentPassRecord {
  id?: number;
  timestamp: number;
  agentId: string;
  intent: string;
  agentThoughts: string;
  toolCallsJson: string;
  followupInstructions: string;
  preResults: string;
  menuSnapshot: string;
  executionsJson: string;
  messageBufferJson?: string;
}

export class PolisDB {
  private db: Database.Database;

  constructor(filename: string = 'polis.sqlite3') {
    this.db = new Database(filename);
    this.init();
  }

  private init() {
    this.db.prepare(`CREATE TABLE IF NOT EXISTS agent_passes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER,
      agentId TEXT,
      intent TEXT,
      agentThoughts TEXT,
      toolCallsJson TEXT,
      followupInstructions TEXT,
      preResults TEXT,
      menuSnapshot TEXT,
      executionsJson TEXT
    )`).run();

    // Migrations: add messageBufferJson if missing
    try { this.db.prepare(`ALTER TABLE agent_passes ADD COLUMN messageBufferJson TEXT`).run(); } catch {}

    // Persisted chat messages per room
    this.db.prepare(`CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER,
      room TEXT,
      agentId TEXT,
      handle TEXT,
      content TEXT
    )`).run();
    this.db.prepare(`CREATE INDEX IF NOT EXISTS chat_messages_room_idx ON chat_messages(room, timestamp DESC)`).run();

    // Items and interactions
    this.db.prepare(`CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      createdTs INTEGER,
      room TEXT,
      ownerId TEXT,
      templateJson TEXT,
      stateJson TEXT
    )`).run();
    this.db.prepare(`CREATE INDEX IF NOT EXISTS items_room_idx ON items(room, createdTs DESC)`).run();

    this.db.prepare(`CREATE TABLE IF NOT EXISTS item_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER,
      itemId INTEGER,
      room TEXT,
      agentId TEXT,
      interactionName TEXT,
      inputsJson TEXT,
      outputsJson TEXT,
      description TEXT,
      updatedStateJson TEXT
    )`).run();
    this.db.prepare(`CREATE INDEX IF NOT EXISTS item_interactions_item_idx ON item_interactions(itemId, timestamp DESC)`).run();

    // Rooms registry (explicit persistence separate from inference via passes/chat)
    this.db.prepare(`CREATE TABLE IF NOT EXISTS rooms (
      name TEXT PRIMARY KEY,
      isPrivate INTEGER,
      createdTs INTEGER
    )`).run();
    this.db.prepare(`CREATE INDEX IF NOT EXISTS rooms_created_idx ON rooms(createdTs DESC)`).run();
  }

  insertPass(rec: AgentPassRecord): number {
    const stmt = this.db.prepare(`INSERT INTO agent_passes 
      (timestamp, agentId, intent, agentThoughts, toolCallsJson, followupInstructions, preResults, menuSnapshot, executionsJson, messageBufferJson)
      VALUES (@timestamp, @agentId, @intent, @agentThoughts, @toolCallsJson, @followupInstructions, @preResults, @menuSnapshot, @executionsJson, @messageBufferJson)`);
    const info = stmt.run(rec);
    return Number(info.lastInsertRowid);
  }

  listRecent(limit: number = 50): AgentPassRecord[] {
    const rows = this.db.prepare(`SELECT * FROM agent_passes ORDER BY id DESC LIMIT ?`).all(limit);
    return rows as AgentPassRecord[];
  }

  listRecentByAgent(agentId: string, limit: number = 50): AgentPassRecord[] {
    const rows = this.db.prepare(
      `SELECT * FROM agent_passes WHERE agentId = ? ORDER BY id DESC LIMIT ?`
    ).all(agentId, limit);
    return rows as AgentPassRecord[];
  }

  listAgents(): { agentId: string; lastTimestamp: number }[] {
    const rows = this.db.prepare(
      `SELECT agentId, MAX(timestamp) as lastTimestamp
       FROM agent_passes
       GROUP BY agentId
       ORDER BY lastTimestamp DESC`
    ).all();
    return rows as { agentId: string; lastTimestamp: number }[];
  }

  insertChatMessage(rec: { timestamp: number; room: string; agentId: string; handle: string; content: string }): number {
    const stmt = this.db.prepare(`INSERT INTO chat_messages (timestamp, room, agentId, handle, content)
      VALUES (@timestamp, @room, @agentId, @handle, @content)`);
    const info = stmt.run(rec);
    return Number(info.lastInsertRowid);
  }

  listRecentChatByRoom(room: string, limit: number = 20): { timestamp: number; room: string; agentId: string; handle: string; content: string }[] {
    // Return the last N messages in chronological order to match incremental updates
    const rows = this.db.prepare(`
      SELECT timestamp, room, agentId, handle, content
      FROM (
        SELECT id, timestamp, room, agentId, handle, content
        FROM chat_messages
        WHERE room = ?
        ORDER BY timestamp DESC, id DESC
        LIMIT ?
      )
      ORDER BY timestamp ASC, id ASC
    `).all(room, limit);
    return rows as any[];
  }

  listChatByRoomSince(room: string, sinceTimestamp: number, limit: number = 200): { timestamp: number; room: string; agentId: string; handle: string; content: string }[] {
    const rows = this.db.prepare(`SELECT timestamp, room, agentId, handle, content
      FROM chat_messages
      WHERE room = ? AND timestamp > ?
      ORDER BY timestamp ASC
      LIMIT ?`).all(room, sinceTimestamp, limit);
    return rows as any[];
  }

  listChatRooms(): { room: string; lastTimestamp: number }[] {
    const rows = this.db.prepare(`SELECT room, MAX(timestamp) as lastTimestamp FROM chat_messages GROUP BY room ORDER BY lastTimestamp DESC`).all();
    return rows as any[];
  }

  // Rooms API
  upsertRoom(rec: { name: string; isPrivate: boolean; createdTs?: number }): void {
    const now = rec.createdTs ?? Date.now();
    this.db.prepare(`INSERT INTO rooms(name, isPrivate, createdTs) VALUES(?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET isPrivate=excluded.isPrivate`).run(rec.name, rec.isPrivate ? 1 : 0, now);
  }

  setRoomVisibility(name: string, isPrivate: boolean): void {
    this.db.prepare(`UPDATE rooms SET isPrivate = ? WHERE name = ?`).run(isPrivate ? 1 : 0, name);
  }

  listPersistedRooms(): { name: string; isPrivate: number; createdTs: number }[] {
    const rows = this.db.prepare(`SELECT name, isPrivate, createdTs FROM rooms ORDER BY createdTs DESC`).all();
    return rows as any[];
  }

  // Items API
  insertItem(rec: { createdTs: number; room: string; ownerId: string; templateJson: string; stateJson: string }): number {
    const stmt = this.db.prepare(`INSERT INTO items (createdTs, room, ownerId, templateJson, stateJson)
      VALUES (@createdTs, @room, @ownerId, @templateJson, @stateJson)`);
    const info = stmt.run(rec);
    return Number(info.lastInsertRowid);
  }

  updateItemState(itemId: number, stateJson: string): void {
    this.db.prepare(`UPDATE items SET stateJson = ? WHERE id = ?`).run(stateJson, itemId);
  }

  deleteItem(itemId: number): void {
    this.db.prepare(`DELETE FROM item_interactions WHERE itemId = ?`).run(itemId);
    this.db.prepare(`DELETE FROM items WHERE id = ?`).run(itemId);
  }

  getItem(itemId: number): { id: number; createdTs: number; room: string; ownerId: string; templateJson: string; stateJson: string } | null {
    const row = this.db.prepare(`SELECT * FROM items WHERE id = ?`).get(itemId);
    return (row as any) || null;
  }

  listItems(): { id: number; createdTs: number; room: string; ownerId: string; templateJson: string; stateJson: string }[] {
    const rows = this.db.prepare(`SELECT * FROM items ORDER BY createdTs DESC, id DESC`).all();
    return rows as any[];
  }

  listItemsSummary(): { itemId: number; createdTs: number; room: string; ownerId: string; templateJson: string; stateJson: string; lastTimestamp: number | null }[] {
    const rows = this.db.prepare(`
      SELECT i.id as itemId, i.createdTs, i.room, i.ownerId, i.templateJson, i.stateJson,
             MAX(ii.timestamp) as lastTimestamp
      FROM items i
      LEFT JOIN item_interactions ii ON ii.itemId = i.id
      GROUP BY i.id
      ORDER BY COALESCE(MAX(ii.timestamp), i.createdTs) DESC
    `).all();
    return rows as any[];
  }

  insertItemInteraction(rec: {
    timestamp: number;
    itemId: number;
    room: string;
    agentId: string;
    interactionName: string;
    inputsJson: string;
    outputsJson: string;
    description: string;
    updatedStateJson: string;
  }): number {
    const stmt = this.db.prepare(`INSERT INTO item_interactions
      (timestamp, itemId, room, agentId, interactionName, inputsJson, outputsJson, description, updatedStateJson)
      VALUES (@timestamp, @itemId, @room, @agentId, @interactionName, @inputsJson, @outputsJson, @description, @updatedStateJson)`);
    const info = stmt.run(rec);
    return Number(info.lastInsertRowid);
  }

  listRecentItemInteractions(itemId: number, limit: number = 50): {
    id: number;
    timestamp: number;
    itemId: number;
    room: string;
    agentId: string;
    interactionName: string;
    inputsJson: string;
    outputsJson: string;
    description: string;
    updatedStateJson: string;
  }[] {
    const rows = this.db.prepare(`SELECT * FROM item_interactions WHERE itemId = ? ORDER BY timestamp DESC, id DESC LIMIT ?`).all(itemId, limit);
    return rows as any[];
  }
}
