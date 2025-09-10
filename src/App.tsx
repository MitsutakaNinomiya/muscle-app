import { useEffect, useMemo, useRef, useState } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { supabase } from "./lib/supabase";

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
  "ベンチプレス","スクワット","デッドリフト","ショルダープレス","ローイング",
  "サイドレイズ","ライイングエクステンション","EZバーカール","その他",
];

const EXERCISE_LABEL: Record<Exercise, string> = Object.fromEntries(EXERCISES.map(e => [e,e])) as any;
const EXERCISE_ORDER = EXERCISES;

export type Log = {
  id: string;
  date: string;
  exercise: Exercise;
  weight: number;
  reps: number;
  note?: string;
};

const STORAGE_KEY = "muscle_logs_v1"; // 既存ローカルの引継ぎ用

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const normalizeExercise = (val: any): Exercise =>
  EXERCISES.includes(val) ? (val as Exercise) : "その他";

const isLog = (x: any): x is Log =>
  x && typeof x.id === "string" && typeof x.date === "string" &&
  typeof x.weight === "number" && typeof x.reps === "number" &&
  EXERCISES.includes(x.exercise);

export default function App() {
  const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"] | null>(null);
  const [loading, setLoading] = useState(true);

  // 初期：セッション取得＆監視
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return <div className="min-h-screen grid place-items-center">Loading...</div>;
  }

  return session ? (
    <AuthedApp userId={session.user.id} />
  ) : (
    <AuthScreen />
  );
}

/* ---------------- Auth 画面 ---------------- */

function AuthScreen() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [mode, setMode] = useState<"signin"|"signup">("signin");
  const [msg, setMsg] = useState<string>("");

  const submit = async () => {
    setMsg("");
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password: pass });
        if (error) throw error;
        setMsg("サインアップ完了。メール認証が必要な場合は案内に従ってください。");
      }
    } catch (e: any) {
      setMsg(e.message ?? "エラーが発生しました");
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50 p-6">
      <div className="w-full max-w-sm rounded border bg-white p-6 space-y-4">
        <h1 className="text-xl font-bold text-center">ログイン</h1>
        <div className="space-y-2">
          <input className="border rounded px-3 py-2 w-full" placeholder="email@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="border rounded px-3 py-2 w-full" placeholder="password" type="password"
            value={pass} onChange={(e) => setPass(e.target.value)} />
        </div>
        <button onClick={submit} className="bg-blue-600 text-white w-full rounded py-2">
          {mode === "signin" ? "サインイン" : "サインアップ"}
        </button>
        <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="text-sm text-blue-700 underline w-full">
          {mode === "signin" ? "新規登録はこちら" : "既にアカウントをお持ちの方はこちら"}
        </button>
        {msg && <p className="text-sm text-center text-gray-600">{msg}</p>}
      </div>
    </div>
  );
}

/* ------------- 認証後の本体（DB連携） ------------- */

function AuthedApp({ userId }: { userId: string }) {
  const [exercise, setExercise] = useState<Exercise>("ベンチプレス");
  const [weight, setWeight] = useState<string>("");
  const [reps, setReps] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const [toast, setToast] = useState<string>("");
  const [logs, setLogs] = useState<Log[]>([]);
  const showToast = (m: string) => { setToast(m); clearTimeout((showToast as any)._t); (showToast as any)._t = setTimeout(()=>setToast(""), 2000); };

  // ① 初回ログイン時：localStorage から Supabase に移行（1回だけ）
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const arr: any[] = Array.isArray(parsed) ? parsed : parsed?.logs;
      if (!Array.isArray(arr) || arr.length === 0) return;
      const rows = arr
        .map((l: any) => ({
          date: String(l?.date || "").slice(0,10),
          exercise: normalizeExercise(l?.exercise),
          weight: Number(l?.weight),
          reps: Number(l?.reps),
          note: typeof l?.note === "string" && l.note.trim() !== "" ? l.note : null,
          user_id: userId,
        }))
        .filter((r) => r.date && r.weight > 0 && r.reps > 0);
      (async () => {
        await supabase.from("logs").insert(rows).then(()=> {
          localStorage.removeItem(STORAGE_KEY);
        });
      })();
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ② ログ取得
  const fetchLogs = async () => {
    const { data, error } = await supabase
      .from("logs")
      .select("id,date,exercise,weight,reps,note")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });
    if (!error && data) {
      setLogs(
        data.map((l) => ({
          id: l.id as string,
          date: l.date as string,
          exercise: normalizeExercise(l.exercise),
          weight: Number(l.weight),
          reps: Number(l.reps),
          note: l.note ?? undefined,
        }))
      );
    }
  };

  useEffect(() => {
    fetchLogs();
    // Realtime を使うならここで購読も可
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ③ 追加
  const canAdd = exercise && weight !== "" && reps !== "" && Number(weight) > 0 && Number(reps) > 0;
  const handleAdd = async () => {
    if (!canAdd) return;
    const trimmedNote = note.trim();
    const { data, error } = await supabase
      .from("logs")
      .insert({
        user_id: userId,
        date: formatDate(selectedDate),
        exercise,
        weight: Number(weight),
        reps: Number(reps),
        note: trimmedNote === "" ? null : trimmedNote,
      })
      .select("id,date,exercise,weight,reps,note")
      .single();
    if (!error && data) {
      setLogs((prev) => [{
        id: data.id as string,
        date: data.date as string,
        exercise: normalizeExercise(data.exercise),
        weight: Number(data.weight),
        reps: Number(data.reps),
        note: data.note ?? undefined,
      }, ...prev]);
      setWeight(""); setReps(""); setNote("");
      showToast("記録を追加したよ");
    }
  };

  // ④ 削除
  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("logs").delete().eq("id", id).eq("user_id", userId);
    if (!error) {
      setLogs((prev) => prev.filter((l) => l.id !== id));
      showToast("1件削除したよ");
    }
  };

  // 便利系
  const dateStr = formatDate(selectedDate);
  const logsForDate = logs.filter((l) => l.date === dateStr);
  const groupedByExercise = useMemo(() => {
    const acc: Record<Exercise, Log[]> = {} as any;
    logsForDate.forEach((l) => { (acc[l.exercise] ??= []).push(l) });
    return acc;
  }, [logsForDate]);
  const volume = (arr: Log[]) => arr.reduce((s, x) => s + x.weight * x.reps, 0);
  const hasLogs = (d: Date) => logs.some((l) => l.date === formatDate(d));
  const fileRef = useRef<HTMLInputElement | null>(null);

  // JSON/CSV 出力はローカル実装のままでもOK（省略）

  return (
    <div className="min-h-screen flex justify-center bg-gray-50">
      <div className="w-full max-w-2xl p-4 sm:p-6 md:p-10 bg-white rounded shadow">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl sm:text-2xl font-bold">筋トレ記録（Supabase版）</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => { await supabase.auth.signOut(); }}
              className="text-xs sm:text-sm border px-3 py-1 rounded hover:bg-gray-50"
            >
              ログアウト
            </button>
          </div>
        </div>

        {toast && (
          <div className="fixed left-1/2 -translate-x-1/2 top-4 z-50 bg-black/80 text-white px-4 py-2 rounded-full text-sm shadow" role="status" aria-live="polite">
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
              onSubmit={(e) => { e.preventDefault(); handleAdd(); }}
              className="flex flex-col items-center gap-3 sm:gap-4 w-full max-w-sm"
            >
              <label className="sr-only" htmlFor="exercise">種目</label>
              <select id="exercise" value={exercise} onChange={(e) => setExercise(e.target.value as Exercise)} className="border rounded px-3 py-2 w-full">
                {EXERCISE_ORDER.map((ex) => (<option key={ex} value={ex}>{EXERCISE_LABEL[ex]}</option>))}
              </select>

              <input type="number" placeholder="重量(kg)" inputMode="decimal" min={1} max={500} step={0.5}
                value={weight} onChange={(e) => setWeight(e.target.value)} className="border rounded px-3 py-2 w-full" />
              <input type="number" placeholder="回数" inputMode="numeric" min={1} max={100} step={1}
                value={reps} onChange={(e) => setReps(e.target.value)} className="border rounded px-3 py-2 w-full" />
              <input type="text" placeholder="メモ（任意）" value={note} onChange={(e) => setNote(e.target.value)} className="border rounded px-3 py-2 w-full" />

              <button type="submit" disabled={!exercise || !weight || !reps} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-40 w-full">
                記録
              </button>
            </form>
          </div>
        </div>

        <div className="w-full max-w-sm mx-auto mt-6 space-y-4">
          {logsForDate.length === 0 && (
            <div className="text-gray-400 text-center">この日の記録はありません</div>
          )}

          {EXERCISE_ORDER.map((ex) => {
            const arr = groupedByExercise[ex];
            if (!arr || arr.length === 0) return null;
            return (
              <div key={ex} className="border rounded bg-white">
                <div className="px-3 py-2 border-b flex items-center justify-between">
                  <div className="font-semibold">{EXERCISE_LABEL[ex]}</div>
                  <div className="text-sm text-gray-600">合計ボリューム: {volume(arr)} kg</div>
                </div>
                <ul className="divide-y">
                  {arr.map((log) => (
                    <li key={log.id} className="px-3 py-2 flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{log.weight} kg × {log.reps} 回</div>
                        {log.note && <div className="text-xs text-gray-500 mt-0.5 truncate" title={log.note}>{log.note}</div>}
                      </div>
                      <button onClick={() => handleDelete(log.id)} className="text-xs px-3 py-1 rounded border border-red-400 text-red-600 hover:bg-red-50">
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
