import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { conversations, InsertTask, InsertUser, messages, Task, tasks, userPreferences, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export type TaskStore = {
  create: (task: InsertTask) => Promise<Task | undefined>;
  list: (userId: number) => Promise<Task[]>;
  get: (userId: number, taskId: number) => Promise<Task | undefined>;
  updateStatus: (userId: number, taskId: number, status: "pending" | "completed" | "cancelled" | "failed") => Promise<Task | undefined>;
  updateDetails: (userId: number, taskId: number, details: { title?: string; scheduledAt?: Date | null }) => Promise<Task | undefined>;
};

let taskStoreOverride: TaskStore | undefined;
export function setTaskStoreOverride(store: TaskStore | undefined) { taskStoreOverride = store; }

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  (['name', 'email', 'loginMethod'] as const).forEach(field => {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  });
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
  else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (!Object.keys(updateSet).length) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function createConversation(userId: number, title: string, mode: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.insert(conversations).values({ userId, title: title.slice(0, 180), mode });
  return Number(result[0].insertId);
}

export async function addMessage(userId: number, conversationId: number, role: "user" | "assistant", content: string, mode?: string, model?: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(messages).values({ userId, conversationId, role, content, mode, model });
}

export async function getConversationMessages(userId: number, conversationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages).where(and(eq(messages.userId, userId), eq(messages.conversationId, conversationId))).orderBy(messages.createdAt);
}

export async function getRecentConversations(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt)).limit(20);
}

export async function getUserContext(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  return result[0] ?? null;
}

export async function saveUserContext(userId: number, contextNotes: string, displayName?: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(userPreferences).values({ userId, contextNotes, displayName }).onDuplicateKeyUpdate({ set: { contextNotes, displayName } });
}

export async function createTask(task: InsertTask): Promise<Task | undefined> {
  if (taskStoreOverride) return taskStoreOverride.create(task);
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.insert(tasks).values(task);
  const taskId = Number(result[0].insertId);
  const created = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, task.userId))).limit(1);
  return created[0];
}

export async function getTasks(userId: number): Promise<Task[]> {
  if (taskStoreOverride) return taskStoreOverride.list(userId);
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(desc(tasks.createdAt)).limit(100);
}

export async function getTask(userId: number, taskId: number): Promise<Task | undefined> {
  if (taskStoreOverride) return taskStoreOverride.get(userId, taskId);
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId))).limit(1);
  return result[0];
}

export async function updateTaskStatus(userId: number, taskId: number, status: "pending" | "completed" | "cancelled" | "failed"): Promise<Task | undefined> {
  if (taskStoreOverride) return taskStoreOverride.updateStatus(userId, taskId, status);
  const db = await getDb();
  if (!db) return undefined;
  await db.update(tasks).set({ status }).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
  return getTask(userId, taskId);
}

export async function updateTaskDetails(userId: number, taskId: number, details: { title?: string; scheduledAt?: Date | null }): Promise<Task | undefined> {
  if (taskStoreOverride) return taskStoreOverride.updateDetails(userId, taskId, details);
  const db = await getDb();
  if (!db) return undefined;
  await db.update(tasks).set(details).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
  return getTask(userId, taskId);
}
