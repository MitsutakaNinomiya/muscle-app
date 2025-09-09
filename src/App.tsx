import { useEffect, useRef, useState, useMemo } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";

export type Exercise =
  | "ベンチプレス"
  | "スクワット"
  | "デッドリフト"
  | "ショルダープレス"
  | "ローイング"
  | "サイドレイズ"
  | "ライイングエクステンション"
  | "EZバーカール"
  | "その他";

const EXERCISES: Exercise[] = [
  "ベンチプレス",
  "スクワット",
  "デッドリフト",
  "ショルダープレス",
  "ローイング",
  "サイドレイズ",
  "ライイングエクステンション",
  "EZバーカール",
  "その他",
];

const EXERCISE_LABEL: Record<Exercise, string> = Object.fromEntries(
  EXERCISES.map((e) => [e, e])
) as Record<Exercise, string>;

const EXERCISE_ORDER: Exercise[] = [
  "ベンチプレス",
  "スクワット",
  "デッドリフト",
  "ショルダープレス",
  "ローイング",
  "サイドレイズ",
  "ライイングエクステンション",
  "EZバーカール",
  "その他",
];

export type Log = {
  id: string;
  date: string; // yyyy-mm-dd
  exercise: Exercise;
  weight: number;
  reps: number;
  note?: string;
};

const STORAGE_KEY = "muscle_logs_v1";
const STORAGE_VERSION = 2 as const;

type StorageShapeV2 = {
  version: number;
  logs: Log[];
};

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const normalizeExercise = (val: any): Exercise =>
  EXERCISES.includes(val) ? (val as Exercise) : "その他";

const isLog = (x: any): x is Log =>
  x &&
  typeof x.id === "string" &&
  typeof x.date === "string" &&
  typeof x.weight === "number" &&
  typeof x.reps === "number" &&
  EXERCISES.includes(x.exercise);

const CSV_HEADER = ["date", "exercise", "weight", "reps", "note"] as const;

type CsvRow = {
  date: string;
  exercise: string;
  weight: string;
  reps: string;
  note?: string;
};

function downloadFile(filename: string, data: string | Blob, mime: string) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function toCSV(logs: Log[]) {
  const rows = logs.map((l) => ({
    date: l.date,
    exercise: l.exercise,
    weight: String(l.weight),
    reps: String(l.reps),
    note: (l.note ?? "").replace(/"/g, '""'),
  }));
  const header = CSV_HEADER.join(",");
  const body = rows
    .map((r) =>
      CSV_HEADER.map((k) => {
        const v = (r as any)[k] ?? "";
        return /[",\n]/.test(v) ? `"${String(v)}"` : String(v);
      }).join(",")
    )
    .join("\n");
  return header + "\n" + body;
}

function parseCSV(text: string): CsvRow[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter(Boolean);
  const header = lines[0].split(",").map((s) => s.trim());
  const idx = (name: string) => header.findIndex((h) => h === name);
  const iDate = idx("date"),
    iEx = idx("exercise"),
    iW = idx("weight"),
    iR = idx("reps"),
    iN = idx("note");
  const out: CsvRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const row: string[] = [];
    let cur = "",
      inQ = false;
    const line = lines[li];
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQ = false;
          }
        } else {
          cur += ch;
        }
      } else {
        if (ch === ",") {
          row.push(cur);
          cur = "";
        } else if (ch === '"') {
          inQ = true;
        } else {
          cur += ch;
        }
      }
    }
    row.push(cur);
    out.push({
      date: row[iDate] ?? "",
      exercise: row[iEx] ?? "",
      weight: row[iW] ?? "",
      reps: row[iR] ?? "",
      note: row[iN] ?? "",
    });
  }
  return out;
}

function csvRowsToLogs(rows: CsvRow[]): Log[] {
  return rows
    .map((r) => {
      const w = Number(r.weight);
      const rp = Number(r.reps);
      const date = String(r.date || "").slice(0, 10);
      const ex = normalizeExercise(r.exercise);
      const id = `${date}-${ex}-${Math.random().toString(36).slice(2, 8)}`;
      const note = r.note && r.note.trim() !== "" ? r.note : undefined;
      if (!date || Number.isNaN(w) || Number.isNaN(rp) || w <= 0 || rp <= 0) {
        return null as any;
      }
      return { id, date, exercise: ex, weight: w, reps: rp, note } as Log;
    })
    .filter(Boolean);
}

const oneRM = (w: number, r: number) => w * (1 + r / 30);

export default function App() {
  const [exercise, setExercise] = useState<Exercise>("ベンチプレス");
  const [weight, setWeight] = useState<string>("");
  const [reps, setReps] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const [toast, setToast] = useState<string>("");
  const showToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToast(""), 2000);
  };

  const [logs, setLogs] = useState<Log[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);

      let arr: any[] = [];
      if (Array.isArray(parsed)) {
        arr = parsed;
      } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).logs)) {
        arr = (parsed as any).logs;
      } else {
        return [];
      }

      const safe = arr
        .map((l: any): Log | null => {
          const id = typeof l?.id === "string" ? l.id : `${Date.now()}-${Math.random()}`;
          const date = typeof l?.date === "string" ? l.date : undefined;
          const w = Number(l?.weight);
          const r = Number(l?.reps);
          const ex = normalizeExercise(l?.exercise);
          const n = typeof l?.note === "string" && l.note.trim() !== "" ? l.note : undefined;
          if (!id || !date || Number.isNaN(w) || Number.isNaN(r)) return null;
          return { id, date, exercise: ex, weight: w, reps: r, note: n };
        })
        .filter((x): x is Log => !!x);

      return safe;
    } catch {
      return [];
    }
  });

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  useEffect(() => {
    const payload: StorageShapeV2 = { version: STORAGE_VERSION, logs };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [logs]);

  const weightNum = Number(weight);
  const repsNum = Number(reps);

  const weightError =
    weight === ""
      ? null
      : Number.isNaN(weightNum)
      ? "数値を入力してね"
      : weightNum <= 0
      ? "0より大きい値にしてね"
      : weightNum > 500
      ? "500kg以下にしてね"
      : null;

  const repsError =
    reps === ""
      ? null
      : Number.isNaN(repsNum)
      ? "数値を入力してね"
      : repsNum <= 0
      ? "1回以上にしてね"
      : repsNum > 100
      ? "100回以下にしてね"
      : null;

  const canAdd = exercise && weight !== "" && reps !== "" && !weightError && !repsError;

  const handleAdd = () => {
    if (!canAdd) return;
    const trimmedNote = note.trim();
    const newLog: Log = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      date: formatDate(selectedDate),
      exercise,
      weight: weightNum,
      reps: repsNum,
      note: trimmedNote === "" ? undefined : trimmedNote,
    };
    setLogs((prev) => [newLog, ...prev]);
    setWeight("");
    setReps("");
    setNote("");
    showToast("記録を追加したよ");
  };

  const handleDelete = (id: string) => {
    setLogs((prev) => prev.filter((log) => log.id !== id));
    showToast("1件削除したよ");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setWeight("");
        setReps("");
        setNote("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasLogs = (d: Date) => logs.some((l) => l.date === formatDate(d));

  const dateStr = formatDate(selectedDate);
  const logsForDate = logs.filter((log) => log.date === dateStr);

  const groupedByExercise = logsForDate.reduce((acc, l) => {
    (acc[l.exercise] ??= []).push(l);
    return acc;
  }, {} as Record<Exercise, Log[]>);

  const volume = (arr: Log[]) => arr.reduce((s, x) => s + x.weight * x.reps, 0);

  const fileRef = useRef<HTMLInputElement | null>(null);

  const exportJSON = () => {
    const payload: StorageShapeV2 = { version: STORAGE_VERSION, logs };
    downloadFile(
      `muscle_logs_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
  };

  const exportCSV = () => {
    downloadFile(
      `muscle_logs_${new Date().toISOString().slice(0, 10)}.csv`,
      toCSV(logs),
      "text/csv;charset=utf-8;"
    );
  };

  const openImport = () => fileRef.current?.click();

  const mergeLogs = (incoming: Log[]) => {
    setLogs((prev) => {
      const map = new Map<string, Log>();
      [...prev, ...incoming].forEach((l) => {
        if (!isLog(l)) return;
        map.set(l.id, l);
      });
      return Array.from(map.values()).sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : 0
      );
    });
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      if (file.name.endsWith(".json")) {
        const obj = JSON.parse(text);
        let arr: any[] = [];
        if (Array.isArray(obj)) arr = obj;
        else if (obj && typeof obj === "object" && Array.isArray(obj.logs)) arr = obj.logs;
        const incoming: Log[] = arr
          .map((l: any) => ({
            id: typeof l?.id === "string" ? l.id : `${Date.now()}-${Math.random()}`,
            date: String(l?.date || "").slice(0, 10),
            exercise: normalizeExercise(l?.exercise),
            weight: Number(l?.weight),
            reps: Number(l?.reps),
            note: typeof l?.note === "string" && l.note.trim() !== "" ? l.note : undefined,
          }))
          .filter(isLog);
        mergeLogs(incoming);
        showToast(`JSONを${incoming.length}件インポートしたよ`);
      } else if (file.name.endsWith(".csv")) {
        const rows = parseCSV(text);
        const incoming = csvRowsToLogs(rows);
        mergeLogs(incoming);
        showToast(`CSVを${incoming.length}件インポートしたよ`);
      } else {
        showToast(".json か .csv を選んでね");
      }
    } catch (err) {
      console.error(err);
      showToast("インポートに失敗したよ");
    } finally {
      e.target.value = "";
    }
  };

  // ===== Step3: ダッシュボード用データ =====
  const lastNDays = 30;

  const dailyData = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = lastNDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = formatDate(d);
      map.set(ds, 0);
    }
    logs.forEach((l) => {
      if (map.has(l.date)) {
        map.set(l.date, (map.get(l.date) || 0) + l.weight * l.reps);
      }
    });
    return Array.from(map.entries()).map(([date, vol]) => ({ date, vol }));
  }, [logs]);

  const bestByExercise = useMemo(() => {
    const res: Record<Exercise, number> = Object.fromEntries(
      EXERCISES.map((e) => [e as Exercise, 0])
    ) as Record<Exercise, number>;
    logs.forEach((l) => {
      if (l.weight > res[l.exercise]) res[l.exercise] = l.weight;
    });
    return res;
  }, [logs]);

  const todayBestByExercise = useMemo(() => {
    const res: Record<Exercise, number> = Object.fromEntries(
      EXERCISES.map((e) => [e as Exercise, 0])
    ) as Record<Exercise, number>;
    logsForDate.forEach((l) => {
      if (l.weight > res[l.exercise]) res[l.exercise] = l.weight;
    });
    return res;
  }, [logsForDate]);

  const prevBestByExercise = useMemo(() => {
    const res: Record<Exercise, number> = Object.fromEntries(
      EXERCISES.map((e) => [e as Exercise, 0])
    ) as Record<Exercise, number>;
    logs
      .filter((l) => l.date !== dateStr)
      .forEach((l) => {
        if (l.weight > res[l.exercise]) res[l.exercise] = l.weight;
      });
    return res;
  }, [logs, dateStr]);

  const prSet = new Set<Exercise>(
    EXERCISES.filter(
      (ex) => todayBestByExercise[ex] > 0 && todayBestByExercise[ex] > prevBestByExercise[ex]
    ) as Exercise[]
  );

  const todayTotalVolume = useMemo(() => volume(logsForDate), [logsForDate]);
  const todayTopOneRM = useMemo(() => {
    let max = 0;
    logsForDate.forEach((l) => {
      const v = oneRM(l.weight, l.reps);
      if (v > max) max = v;
    });
    return Math.round(max * 10) / 10;
  }, [logsForDate]);

  return (
    <div className="min-h-screen flex justify-center bg-gray-50">
      <div className="w-full max-w-2xl p-4 sm:p-6 md:p-10 bg-white rounded shadow">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl sm:text-2xl font-bold">筋トレ記録（カレンダー版）</h1>
          <div className="flex gap-2">
            <button
              onClick={exportCSV}
              className="text-xs sm:text-sm border px-3 py-1 rounded hover:bg-gray-50"
            >
              CSV出力
            </button>
            <button
              onClick={exportJSON}
              className="text-xs sm:text-sm border px-3 py-1 rounded hover:bg-gray-50"
            >
              JSON出力
            </button>
            <button
              onClick={openImport}
              className="text-xs sm:text-sm border px-3 py-1 rounded hover:bg-gray-50"
            >
              インポート
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.csv"
              className="hidden"
              onChange={onImportFile}
            />
          </div>
        </div>

        {toast && (
          <div
            className="fixed left-1/2 -translate-x-1/2 top-4 z-50 bg-black/80 text-white px-4 py-2 rounded-full text-sm shadow"
            role="status"
            aria-live="polite"
          >
            {toast}
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-6 md:gap-10 justify-center">
          <div className="flex-1 flex flex-col items-center">
            <Calendar
              key={logs.length}
              value={selectedDate}
              onChange={(date) => setSelectedDate(date as Date)}
              tileContent={({ date, view }) =>
                view === "month" && hasLogs(date) ? (
                  <div className="mt-1 flex justify-center">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />
                  </div>
                ) : null
              }
            />
            <p className="mt-2 text-gray-600 text-sm">選択日: {formatDate(selectedDate)}</p>
          </div>

          <div className="flex-1 flex justify-center w-full">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAdd();
              }}
              className="flex flex-col items-center gap-3 sm:gap-4 w-full max-w-sm"
            >
              <label className="sr-only" htmlFor="exercise">
                種目
              </label>
              <select
                id="exercise"
                value={exercise}
                onChange={(e) => setExercise(e.target.value as Exercise)}
                className="border rounded px-3 py-2 w-full"
              >
                {EXERCISE_ORDER.map((ex) => (
                  <option key={ex} value={ex}>
                    {EXERCISE_LABEL[ex]}
                  </option>
                ))}
              </select>

              <div className="w-full">
                <label className="sr-only" htmlFor="weight">
                  重量(kg)
                </label>
                <input
                  id="weight"
                  type="number"
                  placeholder="重量(kg)"
                  inputMode="decimal"
                  min={1}
                  max={500}
                  step={0.5}
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  aria-invalid={!!weightError}
                  className={`border rounded px-3 py-2 w-full ${
                    weightError ? "border-red-400 focus:outline-red-500" : ""
                  }`}
                />
                {weightError && (
                  <p className="mt-1 text-xs text-red-500">{weightError}</p>
                )}
              </div>

              <div className="w-full">
                <label className="sr-only" htmlFor="reps">
                  回数
                </label>
                <input
                  id="reps"
                  type="number"
                  placeholder="回数"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  step={1}
                  value={reps}
                  onChange={(e) => setReps(e.target.value)}
                  aria-invalid={!!repsError}
                  className={`border rounded px-3 py-2 w-full ${
                    repsError ? "border-red-400 focus:outline-red-500" : ""
                  }`}
                />
                {repsError && (
                  <p className="mt-1 text-xs text-red-500">{repsError}</p>
                )}
              </div>

              <label className="sr-only" htmlFor="note">
                メモ
              </label>
              <input
                id="note"
                type="text"
                placeholder="メモ（RPEやフォーム課題など／任意）"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="border rounded px-3 py-2 w-full"
              />

              <button
                type="submit"
                disabled={!canAdd}
                className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-40 w-full"
                title="Enterで追加"
              >
                記録
              </button>
              <p className="text-[11px] text-gray-500">
                Enterで追加 / Escで入力クリア
              </p>
            </form>
          </div>
        </div>

        {/* ===== ダッシュボード ===== */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border rounded p-3">
            <div className="font-semibold mb-2">直近30日の総ボリューム</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={dailyData}
                  margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="vol" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="border rounded p-3">
            <div className="font-semibold mb-2">種目別ベスト重量</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={EXERCISE_ORDER.map((ex) => ({
                    ex,
                    best: bestByExercise[ex],
                  }))}
                  margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="ex" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="best" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-sm px-3 py-1 rounded-full bg-gray-100">
            今日の総ボリューム <strong>{todayTotalVolume}</strong> kg
          </span>
          <span className="inline-flex items-center gap-2 text-sm px-3 py-1 rounded-full bg-gray-100">
            今日の推定1RM <strong>{todayTopOneRM}</strong> kg
          </span>
          {prSet.size > 0 && (
            <span className="inline-flex items-center gap-2 text-sm px-3 py-1 rounded-full bg-yellow-100">
              PR達成: {[...prSet].join("・")}
            </span>
          )}
        </div>

        {/* ===== ログ一覧 ===== */}
        <div className="w-full max-w-sm mx-auto mt-6 space-y-4">
          {logsForDate.length === 0 && (
            <div className="text-gray-400 text-center">この日の記録はありません</div>
          )}

          {EXERCISE_ORDER.map((ex) => {
            const arr = groupedByExercise[ex];
            if (!arr || arr.length === 0) return null;
            const isPR = prSet.has(ex);
            return (
              <div key={ex} className="border rounded bg-white">
                <div className="px-3 py-2 border-b flex items-center justify-between">
                  <div className="font-semibold flex items-center gap-2">
                    {EXERCISE_LABEL[ex]}
                    {isPR && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">
                        PR
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600">
                    合計ボリューム: {volume(arr)} kg
                  </div>
                </div>
                <ul className="divide-y">
                  {arr.map((log) => (
                    <li
                      key={log.id}
                      className="px-3 py-2 flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {log.weight} kg × {log.reps} 回
                        </div>
                        <div className="text-xs text-gray-500">
                          推定1RM: {Math.round(oneRM(log.weight, log.reps) * 10) / 10} kg
                        </div>
                        {log.note && (
                          <div
                            className="text-xs text-gray-500 mt-0.5 truncate"
                            title={log.note}
                          >
                            {log.note}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(log.id)}
                        className="text-xs px-3 py-1 rounded border border-red-400 text-red-600 hover:bg-red-50 active:translate-y-0.5 transition"
                        aria-label="この記録を削除"
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
