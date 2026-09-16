export type Mode = "roleplay" | "director";
import type { PresetSummary } from "./presets";
import type { CharacterCard } from "./cards";
export type GenerationStage = "director" | "actor" | "settlement" | "narrator" | "memory";
export type PresetSelection = Record<GenerationStage,string>;
export type StageModelSelection = {settlement:string; narrator:string; memory:string};
export type MemorySource = {type:"event"|"statement"|"inference"; eventIndex?:number; speaker?:string};
export type Memory = { id: string; turnId: string; content: string; kind: "observation" | "belief"; importance: number; source?:MemorySource; tags?:string[]; status?:"active"|"superseded"|"resolved"; supersedes?:string[] };
export type Character = { id: string; name: string; role: string; persona: string; secret: string; color: string; modelId: string; presetId?:string; card?:CharacterCard; state: { location: string; clothing: string; condition: string; emotion: string; thought: string; goal: string; relationship: string }; memories: Memory[] };
export type LibraryCharacter = { id:string; revision:number; character:Character };
export type StoryState = { title: string; world: string; opening: string; player: string; playerPersona: string; playerState: {location:string;clothing:string;condition:string;inventory:string}; style: string; presetSelection?:PresetSelection; stageModels?:StageModelSelection; characters: Character[] };
export type Profile = { id: string; name: string; provider: "openai" | "compatible" | "anthropic" | "gemini"; baseUrl: string; model: string; contextWindow?:number; structuredOutput?:boolean; hasKey?: boolean };
export type StageTrace = {stage:string;modelId:string;modelLabel:string;attempts:number;durationMs:number;cached:boolean;inputCharacters:number;estimatedInputTokens:number;outputCharacters:number};
export type Turn = { id: string; parentId: string | null; input: string; mode: Mode; narrative: string; createdAt: string; demo: boolean; snapshot: StoryState; trace: { selected: string[]; events: string[]; deliveries: { characterId: string; visible: string }[]; presets?:{stage:string;name:string;revision:number;warnings:string[];characters:number}[]; stages?:StageTrace[] } };
export type Workspace = { id: string; stories: {id:string; title:string}[]; revision: number; story: StoryState; headId: string | null; turns: Turn[]; profiles: Profile[]; presets:PresetSummary[]; characterLibrary:LibraryCharacter[]; directorId: string; demo: boolean };

