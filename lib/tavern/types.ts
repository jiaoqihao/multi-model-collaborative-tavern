export type Mode = "roleplay" | "director";
export type Memory = { id: string; turnId: string; content: string; kind: "observation" | "belief"; importance: number };
export type Character = { id: string; name: string; role: string; persona: string; secret: string; color: string; modelId: string; state: { location: string; clothing: string; condition: string; emotion: string; thought: string; goal: string; relationship: string }; memories: Memory[] };
export type StoryState = { title: string; world: string; opening: string; player: string; playerPersona: string; playerState: {location:string;clothing:string;condition:string;inventory:string}; style: string; characters: Character[] };
export type Profile = { id: string; name: string; provider: "openai" | "compatible" | "anthropic" | "gemini"; baseUrl: string; model: string; hasKey?: boolean };
export type Turn = { id: string; parentId: string | null; input: string; mode: Mode; narrative: string; createdAt: string; demo: boolean; snapshot: StoryState; trace: { selected: string[]; events: string[]; deliveries: { characterId: string; visible: string }[] } };
export type Workspace = { id: string; stories: {id:string; title:string}[]; revision: number; story: StoryState; headId: string | null; turns: Turn[]; profiles: Profile[]; directorId: string; demo: boolean };
