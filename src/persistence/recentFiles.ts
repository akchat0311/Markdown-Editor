import { getDB, RECENT_STORE } from "./db";

export interface RecentFile {
  name: string;
  lastOpened: number;
  handle?: FileSystemFileHandle;
}

const MAX_RECENT = 10;

export async function addRecentFile(entry: RecentFile): Promise<void> {
  const db = await getDB();
  await db.put(RECENT_STORE, entry);
  const all: RecentFile[] = await db.getAll(RECENT_STORE);
  if (all.length > MAX_RECENT) {
    all.sort((a, b) => a.lastOpened - b.lastOpened);
    for (const old of all.slice(0, all.length - MAX_RECENT)) {
      await db.delete(RECENT_STORE, old.name);
    }
  }
}

export async function getRecentFiles(): Promise<RecentFile[]> {
  const db = await getDB();
  const all: RecentFile[] = await db.getAll(RECENT_STORE);
  return all.sort((a, b) => b.lastOpened - a.lastOpened);
}

export async function removeRecentFile(name: string): Promise<void> {
  const db = await getDB();
  await db.delete(RECENT_STORE, name);
}
