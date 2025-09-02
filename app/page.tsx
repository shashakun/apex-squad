"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarDays,
  Download,
  Upload,
  Plus,
  Trash2,
  ExternalLink,
  NotebookPen,
  Link as LinkIcon,
  Users,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { createClient } from "@supabase/supabase-js";

/**
 * APEX Squad Single-File App (React + Tailwind + shadcn/ui)
 *
 * Features:
 * 1) Weekly scheduler (day-level): tap check / question / cross per player
 * 2) Shared notepad (plus per-person tabs)
 * 3) Shared resources list (title + URL + type + description)
 *
 * New in this version:
 * - Editable team name
 * - Week picker anchored to the selected week (fixes label drift)
 * - **Cloud sync via Supabase** (schedule, notes, resources, team name) — real-time for everyone with the same TEAM_CODE
 * - Still supports Export/Import as a backup
 *
 * Data persistence: Supabase (primary) with optional local cache fallback.
 */

// === Config ===
const PLAYERS = ["Potato", "YX8", "Champerrin"] as const;
const STORAGE_KEY = "apex-squad-cache-v1"; // local fallback cache

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
export const TEAM_CODE = (process.env.NEXT_PUBLIC_TEAM_CODE as string) || "apex-squad-demo";

export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  : null;

// Key-value doc helpers in Supabase
// Strong types to avoid `any`
type WeekDoc = Record<Player, Record<string, DayStatus>>;
type NotesDoc = { content: string };
type TeamNameDoc = { name: string };
type ResourcesDoc = Array<{ id: string; title: string; url: string; type: string; desc?: string }>;

async function getDoc<T>(key: string): Promise<T | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("apex_docs")
    .select("value")
    .eq("team_code", TEAM_CODE)
    .eq("key", key)
    .maybeSingle();
  if (error) return null;
  return (data?.value as T) ?? null;
}

async function upsertDoc<T>(key: string, value: T): Promise<void> {
  if (!supabase) return;
  await supabase.from("apex_docs").upsert({ team_code: TEAM_CODE, key, value });
}

// Heat color for team YES count (0..3)
export function colorForCount(n: number) {
  if (n >= 3) return "bg-emerald-500 text-white";
  if (n === 2) return "bg-emerald-300 text-emerald-900";
  if (n === 1) return "bg-emerald-100 text-emerald-900";
  return "bg-muted text-muted-foreground";
}

function availIconFor(player: string) {
  const colors: Record<string, string> = {
    Potato: "bg-pink-400",
    YX8: "bg-indigo-400",
    Champerrin: "bg-amber-400",
  };
  return (
    <span
      className={classNames(
        "inline-block h-2.5 w-2.5 rounded-full",
        colors[player] || "bg-slate-400"
      )}
      title={player}
    />
  );
}

// === Persistence hook (local cache) ===
function useLocalState<T>(defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, [state]);
  return [state, setState];
}

// === Data model ===

type Player = typeof PLAYERS[number];

type DayStatus = "YES" | "TBD" | "NO"; // underlying value; UI uses check / question / cross

const STATUS_LABEL: Record<DayStatus, string> = {
  YES: "\u2705",
  TBD: "\u2753", // explicit TBD shows a question mark
  NO: "\u274C",
};

const STATUS_TEXT_CLASS: Record<DayStatus, string> = {
  YES: "text-emerald-700",
  TBD: "text-amber-700",
  NO: "text-slate-500",
};

interface AppData {
  players: Player[];
  activePlayer: Player;
  teamName: string;
  schedule: Record<string, unknown>;
  scheduleDays: Record<string, Record<Player, Record<string, DayStatus>>>; // { weekKey: { player: { YYYY-MM-DD: status } } }
  notes: Record<"shared" | Player, string>;
  resources: Array<{ id: string; title: string; url: string; type: string; desc?: string }>;
}

const initialData: AppData = {
  players: [...PLAYERS],
  activePlayer: PLAYERS[0],
  teamName: "APEX Squad",
  schedule: {},
  scheduleDays: {},
  notes: { shared: "", Potato: "", YX8: "", Champerrin: "" },
  resources: [],
};

// === Header ===
function Header({ data, setData, weekStart, setWeekStart }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>>; weekStart: Date; setWeekStart: (d: Date) => void; }) {
  const wk = weekKey(weekStart);
  const windowWeeks = getWeeksFrom(weekStart, 4); // anchored to selected week
  const nameDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(startOfWeek(d));
  };

  // Persist team name to cloud (debounced)
  const onNameChange = (val: string) => {
    setData((s) => ({ ...s, teamName: val }));
    if (nameDebounce.current) clearTimeout(nameDebounce.current);
    nameDebounce.current = setTimeout(() => {
      upsertDoc('team:name', { name: val }).catch(() => {});
    }, 400);
  };

  useEffect(() => {
    (async () => {
      const nm = await getDoc<TeamNameDoc>('team:name');
      if (nm?.name) setData((s) => ({ ...s, teamName: nm.name }));
    })();
  }, [setData]);

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6" />
        <div>
          <Input
            aria-label="Team name"
            value={data.teamName}
            onChange={(e) => onNameChange(e.target.value)}
            className="text-2xl font-bold bg-transparent border-0 p-0 h-auto focus-visible:ring-0 focus-visible:outline-none"
            placeholder="Team name"
          />
          <p className="text-xs text-muted-foreground">Team code: <span className="font-mono">{TEAM_CODE}</span> • Week of {formatDate(weekStart)} <Badge variant="secondary" className="ml-1">{wk}</Badge></p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => shiftWeek(-1)} title="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
          <Select value={"0"} onValueChange={(v) => setWeekStart(windowWeeks[Number(v)] || windowWeeks[0])}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Pick week" />
            </SelectTrigger>
            <SelectContent>
              {windowWeeks.map((d, i) => (
                <SelectItem key={d.toISOString()} value={String(i)}>{formatDate(d)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => shiftWeek(1)} title="Next week"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">I am</span>
          <Select
            defaultValue={data.activePlayer}
            onValueChange={(v) => setData((s) => ({ ...s, activePlayer: v as Player }))}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Select player" />
            </SelectTrigger>
            <SelectContent>
              {PLAYERS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DataIO data={data} setData={setData} />
      </div>
    </div>
  );
}

// === Export / Import ===
function DataIO({ data, setData }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>> }) {
  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "apex-squad-data.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importData = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result)) as AppData;
        setData(json);
        // push some parts to cloud
        upsertDoc('team:name', { name: json.teamName }).catch(() => {});
        upsertDoc('resources', json.resources).catch(() => {});
        for (const wk in json.scheduleDays) upsertDoc(`schedule:${wk}`, json.scheduleDays[wk]).catch(() => {});
        upsertDoc('notes:shared', { content: json.notes.shared }).catch(() => {});
        for (const p of PLAYERS) upsertDoc(`notes:${p}`, { content: json.notes[p] || '' }).catch(() => {});
      } catch {
        alert("Invalid JSON file.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={exportData}>
        <Download className="h-4 w-4 mr-1" /> Export
      </Button>
      <label className="inline-flex items-center">
        <input
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])}
        />
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4 mr-1" /> Import
        </Button>
      </label>
    </div>
  );
}

// === Scheduler (day-level labels) ===
function Scheduler({ data, setData, weekStart }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>>; weekStart: Date; }) {
  const dates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const wk = weekKey(weekStart);
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);

  // Ensure week structure exists for day-level scheduling
  useEffect(() => {
    setData((s) => {
      const scheduleDays = { ...(s.scheduleDays || {}) };
      if (!scheduleDays[wk]) scheduleDays[wk] = {} as Record<Player, Record<string, DayStatus>>;
      for (const p of PLAYERS) scheduleDays[wk][p] = scheduleDays[wk][p] || {};
      return { ...s, scheduleDays };
    });
  }, [wk, setData]);

  const setStatus = (player: Player, key: string, status: DayStatus) => {
    setData((s) => {
      const scheduleDays = { ...(s.scheduleDays || {}) };
      const week = { ...(scheduleDays[wk] || {}) } as Record<Player, Record<string, DayStatus>>;
      const playerDays = { ...(week[player] || {}) } as Record<string, DayStatus>;
      playerDays[key] = status;
      week[player] = playerDays;
      scheduleDays[wk] = week;
      return { ...s, scheduleDays };
    });
    // push to cloud (upsert whole week blob)
    const weekBlob = data.scheduleDays?.[wk] || {};
    const nextBlob = { ...weekBlob, [player]: { ...(weekBlob[player] || {}), [key]: status } };
    upsertDoc(`schedule:${wk}`, nextBlob).catch(() => {});
  };

  // subscribe to realtime changes for this week
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('apex_docs_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'apex_docs', filter: `team_code=eq.${TEAM_CODE}` }, (payload: { new: { key: string; value: unknown } }) => {
        const row = payload.new as { key: string; value: unknown };
        if (row?.key === `schedule:${wk}`) setData((s) => ({ ...s, scheduleDays: { ...s.scheduleDays, [wk]: row.value as WeekDoc } }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [wk, setData]);

  // Load current week from cloud on mount/week change
  useEffect(() => {
    (async () => {
      const cloud = await getDoc<WeekDoc>(`schedule:${wk}`);
      if (cloud) setData((s) => ({ ...s, scheduleDays: { ...s.scheduleDays, [wk]: cloud as WeekDoc } }));
    })();
  }, [wk, setData]);

  const statusFor = (player: Player, key: string): DayStatus | undefined => (data.scheduleDays?.[wk]?.[player]?.[key]);

  const countsYes = useMemo(() => {
    const c: Record<string, number> = {};
    const week = data.scheduleDays?.[wk] || {};
    for (const d of dates) {
      const k = dayKey(d);
      let n = 0;
      for (const p of PLAYERS) if (week[p]?.[k] === "YES") n++;
      c[k] = n;
    }
    return c;
  }, [data.scheduleDays, wk, dates]);

  const active = data.activePlayer;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5" /> Weekly Availability (tap <span className="mx-1">{"\u2705"} / {"\u2753"} / {"\u274C"}</span> for <strong className="ml-1">{active}</strong>)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Row</TableHead>
                {dates.map((d) => (
                  <TableHead key={d.toISOString()} className="text-center">
                    <div className="font-medium">{weekdayLabel(d)}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(d)}</div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Team {"\u2705"}</TableCell>
                {dates.map((d) => {
                  const k = dayKey(d);
                  const n = countsYes[k] || 0;
                  return (
                    <TableCell key={k} className="p-2">
                      <div className={classNames("rounded-md px-2 py-1 text-xs border", colorForCount(n))}>
                        {n}/3 {"\u2705"} {n === 3 ? "★" : ""}
                      </div>
                      <div className="mt-1 flex items-center justify-center gap-2 text-[12px]">
                        {PLAYERS.map((p) => {
                          const st = statusFor(p, k);
                          const label = st ? STATUS_LABEL[st] : "?"; // default '?' when unset
                          const cls = st ? STATUS_TEXT_CLASS[st] : "text-slate-500";
                          return (
                            <span key={p} className="inline-flex items-center gap-1">
                              {availIconFor(p)}
                              <span className={cls}>{label}</span>
                            </span>
                          );
                        })}
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>

              <TableRow>
                <TableCell className="font-medium">Set for {active}</TableCell>
                {dates.map((d) => {
                  const k = dayKey(d);
                  const current = statusFor(active, k);
                  const Opt = ({ value, children }: { value: DayStatus; children: React.ReactNode }) => (
                    <Button
                      size="sm"
                      variant={current === value ? "default" : "outline"}
                      className="px-2 py-1 text-xs"
                      onClick={() => setStatus(active, k, value)}
                      title={value}
                    >
                      {children}
                    </Button>
                  );
                  return (
                    <TableCell key={k} className="p-2">
                      <div className="inline-flex items-center gap-1 border rounded-md p-1">
                        <Opt value="YES">{"\u2705"}</Opt>
                        <Opt value="TBD">{"\u2753"}</Opt>
                        <Opt value="NO">{"\u274C"}</Opt>
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-emerald-500" /> {"\u2705"}</div>
          <div className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-amber-400" /> {"\u2753"}</div>
          <div className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-slate-300" /> {"\u274C"}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// === Notepad ===
function Notepad({ data, setData }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>> }) {
  const [tab, setTab] = useState<"shared" | Player>("shared");
  const val = data.notes[tab] ?? "";
  const save = (text: string) => {
    setData((s) => ({ ...s, notes: { ...s.notes, [tab]: text } }));
    const key = tab === 'shared' ? 'notes:shared' : `notes:${tab}`;
    upsertDoc(key, { content: text }).catch(() => {});
  };

  // realtime subscription for notes + team name
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('apex_notes_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'apex_docs', filter: `team_code=eq.${TEAM_CODE}` }, (payload: { new: { key: string; value: unknown } }) => {
        const row = payload.new as { key: string; value: unknown };
        if (!row) return;
        if (row.key === 'notes:shared') setData((s) => ({ ...s, notes: { ...s.notes, shared: row.value?.content || '' } }));
        for (const p of PLAYERS) if (row.key === `notes:${p}`) setData((s) => ({ ...s, notes: { ...s.notes, [p]: row.value?.content || '' } }));
        if (row.key === 'team:name') setData((s) => ({ ...s, teamName: row.value?.name || s.teamName }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [setData]);

  // initial load of notes
  useEffect(() => {
    (async () => {
      const shared = await getDoc<NotesDoc>('notes:shared');
      if (shared) setData((s) => ({ ...s, notes: { ...s.notes, shared: shared.content || '' } }));
      for (const p of PLAYERS) {
        const n = await getDoc<NotesDoc>(`notes:${p}`);
        if (n) setData((s) => ({ ...s, notes: { ...s.notes, [p]: n.content || '' } }));
      }
    })();
  }, [setData]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><NotebookPen className="h-5 w-5" /> Squad Notepad</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as "shared" | Player)}>
          <TabsList>
            <TabsTrigger value="shared">Shared</TabsTrigger>
            {PLAYERS.map((p) => (
              <TabsTrigger key={p} value={p}>{p}</TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={tab} className="mt-4">
            <Textarea
              value={val}
              onChange={(e) => save(e.target.value)}
              placeholder={tab === "shared" ? "Team reflections, reminders, and strategies..." : `Notes for ${tab}...`}
              className="min-h-[180px]"
            />
            <div className="mt-2 text-xs text-muted-foreground">Auto-saved to cloud for team code <span className="font-mono">{TEAM_CODE}</span>.</div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// === Resources ===
function ResourceForm({ onAdd }: { onAdd: (r: { id: string; title: string; url: string; type: string; desc?: string }) => void }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState("Video");
  const [desc, setDesc] = useState("");

  const add = () => {
    if (!title || !url) {
      alert("Please enter a title and URL");
      return;
    }
    try {
      const u = new URL(url.startsWith("http") ? url : `https://${url}`);
      onAdd({ id: crypto.randomUUID(), title, url: u.toString(), type, desc });
      setTitle(""); setUrl(""); setType("Video"); setDesc("");
    } catch {
      alert("Invalid URL");
    }
  };

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-end">
      <div className="flex-1">
        <label className="text-xs text-muted-foreground">Title</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., TSM Macro Breakdown" />
      </div>
      <div className="flex-1">
        <label className="text-xs text-muted-foreground">URL</label>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Type</label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["Video", "Website", "Tutorial", "Loadout", "Map Guide", "Other"].map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1">
        <label className="text-xs text-muted-foreground">Description</label>
        <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Why it's useful..." />
      </div>
      <Button onClick={add}><Plus className="h-4 w-4 mr-1" /> Add</Button>
    </div>
  );
}

function Resources({ data, setData }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>> }) {
  const add = (r: { id: string; title: string; url: string; type: string; desc?: string }) => {
    setData((s) => ({ ...s, resources: [r, ...s.resources] }));
    upsertDoc('resources', [r, ...data.resources]).catch(() => {});
  };
  const remove = (id: string) => {
    const next = data.resources.filter((x) => x.id !== id);
    setData((s) => ({ ...s, resources: next }));
    upsertDoc('resources', next).catch(() => {});
  };

  // realtime + initial load
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('apex_resources_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'apex_docs', filter: `team_code=eq.${TEAM_CODE}` }, (payload: { new: { key: string; value: unknown } }) => {
        const row = payload.new as { key: string; value: unknown };
        if (row?.key === 'resources') setData((s) => ({ ...s, resources: (row.value || []) as ResourcesDoc }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [setData]);

  useEffect(() => {
    (async () => {
      const res = await getDoc<ResourcesDoc>('resources');
      if (res) setData((s) => ({ ...s, resources: res as ResourcesDoc }));
    })();
  }, [setData]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><LinkIcon className="h-5 w-5" /> Shared Resources</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ResourceForm onAdd={add} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.resources.map((r) => (
            <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="h-full">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-tight">{r.title}</CardTitle>
                    <Badge variant="secondary">{r.type}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {r.desc && <p className="text-sm text-muted-foreground">{r.desc}</p>}
                  <div className="flex items-center justify-between">
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-sm inline-flex items-center gap-1 hover:underline">
                      Open <ExternalLink className="h-4 w-4" />
                    </a>
                    <Button variant="ghost" size="icon" onClick={() => remove(r.id)} title="Remove">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
          {data.resources.length === 0 && (
            <div className="text-sm text-muted-foreground">No resources yet — add your first above!</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// === App ===
export default function ApexSquadApp() {
  const [data, setData] = useLocalState<AppData>(initialData);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfNextWeek(new Date()));

  const cloudReady = !!supabase;

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8 space-y-6">
      {!cloudReady && (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-3 text-sm">
          Cloud sync disabled (missing Supabase env). The app will only save to this browser.
        </div>
      )}
      <Header data={data} setData={setData} weekStart={weekStart} setWeekStart={setWeekStart} />

      <div className="grid grid-cols-1 gap-6">
        <Scheduler data={data} setData={setData} weekStart={weekStart} />
        <Notepad data={data} setData={setData} />
        <Resources data={data} setData={setData} />
      </div>

      <footer className="pt-4 text-xs text-muted-foreground">
        <p>
          Data is synced to the cloud for team code <span className="font-mono">{TEAM_CODE}</span> when Supabase env vars are configured. Otherwise, Export/Import works locally.
        </p>
      </footer>
    </div>
  );
}

// === Minimal runtime tests (executed once on load) ===
(function runTests() {
  try {
    const sun = new Date("2025-08-31T12:00:00Z"); // Sunday
    const mon = startOfNextWeek(sun);
    console.assert(mon.getDay() === 1, "startOfNextWeek should land on Monday");

    const wk = weekKey(new Date("2025-09-01T00:00:00Z"));
    console.assert(/\d{4}-\d{2}-\d{2}/.test(wk), "weekKey should be YYYY-MM-DD");

    console.assert(getWeekDates(new Date("2025-09-01T00:00:00Z")).length === 7, "getWeekDates should return 7 days");

    console.assert(colorForCount(0).includes("bg-"), "colorForCount returns a class string");

    const base = new Date("2025-09-29T00:00:00Z"); // Monday
    const win = getWeeksFrom(base, 4);
    console.assert(win[0].getDate() === 29 && win[0].getMonth() === 8, "window[0] should equal selected start (Sep 29)");
    console.assert(win[1].getDate() === 6 && win[1].getMonth() === 9, "window[1] should be Oct 6");

    console.assert(STATUS_LABEL.YES === "\u2705" && STATUS_LABEL.TBD === "\u2753" && STATUS_LABEL.NO === "\u274C", "STATUS_LABEL baseline");
  } catch (err) {
    // Never throw in production; just log. These are smoke tests.
    console.warn("App tests encountered an error:", err);
  }
})();
