import type { Grade } from "../game/grade";

interface SharePayload {
  accuracy: string;
  grade: Grade;
  songName: string;
  artist: string;
  difficulty: string;
  lang: string;
}

export async function shareResult(payload: SharePayload): Promise<boolean> {
  const { accuracy, grade, songName, artist, difficulty, lang } = payload;
  const url = window.location.href;
  const songId = artist ? `${songName} — ${artist}` : songName;
  const diff = difficulty.toUpperCase();
  const text = lang === "jp"
    ? `「${songId}」の${diff}で ${accuracy} (${grade}) を獲得しました！\n${url}`
    : `I scored ${accuracy} (${grade}) on ${diff} of "${songId}" in mimi!\n${url}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: "mimi", text, url });
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return false;
    }
  }

  return copyToClipboard(text);
}

function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text).then(() => true, () => execCommandCopy(text));
  }
  return Promise.resolve(execCommandCopy(text));
}

function execCommandCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  return ok;
}
