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
  }

  insertPass(rec: AgentPassRecord): number {
    const stmt = this.db.prepare(`INSERT INTO agent_passes 
      (timestamp, agentId, intent, agentThoughts, toolCallsJson, followupInstructions, preResults, menuSnapshot, executionsJson)
      VALUES (@timestamp, @agentId, @intent, @agentThoughts, @toolCallsJson, @followupInstructions, @preResults, @menuSnapshot, @executionsJson)`);
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
    const rows = this.db.prepare(`SELECT timestamp, room, agentId, handle, content FROM chat_messages WHERE room = ? ORDER BY id DESC LIMIT ?`).all(room, limit);
    return rows as any[];
  }

  listChatRooms(): { room: string; lastTimestamp: number }[] {
    const rows = this.db.prepare(`SELECT room, MAX(timestamp) as lastTimestamp FROM chat_messages GROUP BY room ORDER BY lastTimestamp DESC`).all();
    return rows as any[];
  }
}
