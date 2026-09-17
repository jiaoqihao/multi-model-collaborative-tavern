import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";
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
export const generationStages = sqliteTable("generation_stages", {
 requestId:text("request_id").notNull(), stageKey:text("stage_key").notNull(), storyId:text("story_id").notNull().references(()=>stories.id),
 owner:text("owner").notNull(), fingerprint:text("fingerprint").notNull(), data:text("data").notNull(), updatedAt:text("updated_at").notNull()
},t=>[primaryKey({columns:[t.requestId,t.stageKey]}),index("idx_generation_stages_story_owner").on(t.storyId,t.owner)]);
export const storyEvents = sqliteTable("story_events", {
 id:text("id").primaryKey(), storyId:text("story_id").notNull().references(()=>stories.id), turnId:text("turn_id").notNull().references(()=>turns.id),
 eventIndex:integer("event_index").notNull(), description:text("description").notNull(), visibleTo:text("visible_to").notNull(), visibleToPlayer:integer("visible_to_player").notNull(), createdAt:text("created_at").notNull()
},t=>[index("idx_story_events_story_turn").on(t.storyId,t.turnId),index("idx_story_events_turn_index").on(t.turnId,t.eventIndex)]);
export const storySummaryRecords = sqliteTable("story_summary_records", {
 id:text("id").primaryKey(), storyId:text("story_id").notNull().references(()=>stories.id), turnId:text("turn_id").notNull().references(()=>turns.id),
 level:text("level").notNull(), content:text("content").notNull(), sourceTurnIds:text("source_turn_ids").notNull(), createdAt:text("created_at").notNull()
},t=>[index("idx_story_summaries_story_turn").on(t.storyId,t.turnId)]);
export const storyThreadRecords = sqliteTable("story_thread_records", {
 id:text("id").primaryKey(), threadId:text("thread_id").notNull(), storyId:text("story_id").notNull().references(()=>stories.id), turnId:text("turn_id").notNull().references(()=>turns.id),
 description:text("description").notNull(), characterIds:text("character_ids").notNull(), status:text("status").notNull(), sourceEventIndex:integer("source_event_index"), createdAt:text("created_at").notNull()
},t=>[index("idx_story_threads_story_turn").on(t.storyId,t.turnId),index("idx_story_threads_thread").on(t.threadId)]);
