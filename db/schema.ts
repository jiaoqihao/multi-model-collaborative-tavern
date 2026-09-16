import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const stories = sqliteTable("stories", {
 id:text("id").primaryKey(), owner:text("owner").notNull(), title:text("title").notNull(),
 data:text("data").notNull(), root:text("root").notNull(), headId:text("head_id"),
 revision:integer("revision").notNull().default(0), demo:integer("demo").notNull().default(1), directorId:text("director_id").notNull().default(""), createdAt:text("created_at").notNull()
}, t=>[index("idx_stories_owner_created").on(t.owner,t.createdAt)]);
export const turns = sqliteTable("turns", {
 id:text("id").primaryKey(), storyId:text("story_id").notNull().references(()=>stories.id), parentId:text("parent_id"), data:text("data").notNull(), createdAt:text("created_at").notNull()
}, t=>[index("idx_turns_story_created").on(t.storyId,t.createdAt)]);
export const profiles = sqliteTable("profiles", { id:text("id").primaryKey(), owner:text("owner").notNull(), data:text("data").notNull(), encryptedKey:text("encrypted_key").notNull() },t=>[index("idx_profiles_owner").on(t.owner)]);
export const presets = sqliteTable("presets", {
 id:text("id").primaryKey(), owner:text("owner").notNull(), data:text("data").notNull(), revision:integer("revision").notNull().default(1)
},t=>[index("idx_presets_owner").on(t.owner)]);
export const characterLibrary = sqliteTable("character_library", {
 id:text("id").primaryKey(), owner:text("owner").notNull(), data:text("data").notNull(),
 revision:integer("revision").notNull().default(1), createdAt:text("created_at").notNull(), updatedAt:text("updated_at").notNull()
},t=>[index("idx_character_library_owner_updated").on(t.owner,t.updatedAt)]);
