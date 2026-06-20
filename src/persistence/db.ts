import { openDB, type IDBPDatabase } from "idb";
import type { PersistedDocument } from "@/types/document";

const DB_NAME = "md-editor";
const DB_VERSION = 2;
const DOCS_STORE = "documents";
export const RECENT_STORE = "recent_files";

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore(DOCS_STORE, { keyPath: "id" });
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(RECENT_STORE)) {
            db.createObjectStore(RECENT_STORE, { keyPath: "name" });
          }
        }
      },
    });
  }
  return dbPromise;
}

export async function saveDocument(doc: PersistedDocument): Promise<void> {
  const db = await getDB();
  await db.put(DOCS_STORE, doc);
}

export async function loadDocument(id: string): Promise<PersistedDocument | undefined> {
  const db = await getDB();
  return db.get(DOCS_STORE, id);
}

export async function listDocuments(): Promise<PersistedDocument[]> {
  const db = await getDB();
  return db.getAll(DOCS_STORE);
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(DOCS_STORE, id);
}
