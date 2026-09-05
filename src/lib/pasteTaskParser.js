// Parser for the Super Admin "Paste Tasks" bulk feature. Pure + deterministic so
// the preview (client) and any server-side re-check share one implementation.
//
// Input: free text where a USER NAME sits on its own line, followed by that
// user's task lines. Supports (per spec): plain lines, a trailing colon after
// the name, blank lines, "1." / "1)" numbering, and "-" / "•" / "*" bullets.
// Multi-word task lines are kept whole (never split on spaces).
//
// Output: sections grouped by the detected user, each carrying a resolution
// against the REAL user list — never inventing a user. The caller resolves any
// ambiguous / not-found section before creating tasks.

const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const stripColon = (s) => String(s || "").replace(/[:：]\s*$/, "").trim();

// A task line: drop a leading bullet or "1." / "1)" numbering, keep the rest.
export function cleanTaskLine(line) {
  return String(line || "")
    .replace(/^\s*[-•*·▪]\s+/, "")     // bullet markers
    .replace(/^\s*\d+[.)]\s+/, "")     // 1.  or  1)
    .trim();
}

// Build name → [userId] lookups (exact username and normalized).
function buildIndex(users) {
  const byExact = new Map();
  const byNorm = new Map();
  for (const u of users || []) {
    const name = String(u.username ?? u.name ?? "");
    if (!name) continue;
    if (!byExact.has(name)) byExact.set(name, []);
    byExact.get(name).push(u.id);
    const n = norm(name);
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(u.id);
  }
  return { byExact, byNorm };
}

// Resolve one name against the index. Priority: exact-unique → normalized-unique
// → ambiguous (>1) → not found. Never guesses when more than one user matches.
function resolveName(rawName, idx) {
  const name = stripColon(rawName);
  const exact = idx.byExact.get(name);
  if (exact && exact.length === 1) return { status: "ok", userId: exact[0], name };
  const nm = idx.byNorm.get(norm(name)) || [];
  const uniq = [...new Set(nm)];
  if (uniq.length === 1) return { status: "ok", userId: uniq[0], name };
  if (uniq.length > 1) return { status: "ambiguous", candidateIds: uniq, name };
  return { status: "notfound", name };
}

// Is this line a USER HEADER? A header is a line that (colon-stripped) matches a
// known user name. Task lines are everything else. A line carrying a bullet or
// number marker is ALWAYS a task (never a user), so a name that happens to be
// bulleted stays a task.
function isUserHeader(line, idx) {
  if (/^\s*([-•*·▪]|\d+[.)])\s+/.test(line)) return false;
  const name = stripColon(line);
  if (!name) return false;
  return idx.byExact.has(name) || idx.byNorm.has(norm(name));
}

// Parse text → { sections }. Each section: { key, rawName, name, status,
// userId, candidateIds, tasks: string[] }. Tasks that appear before any user
// header land in a synthetic `no_user` section so they surface as errors rather
// than being silently dropped.
export function parsePastedTasks(text, users) {
  const idx = buildIndex(users);
  const sections = [];
  let current = null;
  let counter = 0;

  const startSection = (res, rawName) => {
    counter += 1;
    current = {
      key: `s${counter}`,
      rawName,
      name: res.name,
      status: res.status,          // ok | ambiguous | notfound
      userId: res.status === "ok" ? res.userId : null,
      candidateIds: res.candidateIds || null,
      tasks: [],
    };
    sections.push(current);
  };

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (isUserHeader(line, idx)) {
      startSection(resolveName(line, idx), line);
      continue;
    }
    const task = cleanTaskLine(line);
    if (!task) continue;
    if (!current) {
      // Tasks before any user header — a hard error section.
      counter += 1;
      current = { key: `s${counter}`, rawName: "", name: "", status: "no_user", userId: null, candidateIds: null, tasks: [] };
      sections.push(current);
    }
    current.tasks.push(task);
  }

  // Drop user headers that carried no tasks (a stray name line = nothing to do).
  return { sections: sections.filter((s) => s.tasks.length > 0) };
}

// Flatten resolved sections to the API payload rows. Only sections whose status
// is "ok" (originally unique, or manually resolved) with a real userId are
// emitted; the caller must ensure there are no remaining error sections.
export function sectionsToTasks(sections) {
  const out = [];
  for (const s of sections || []) {
    if (s.status !== "ok" || !s.userId) continue;
    for (const title of s.tasks) {
      const t = String(title || "").trim();
      if (t) out.push({ userId: String(s.userId), title: t });
    }
  }
  return out;
}

// Summary counts for the preview header.
export function summarize(sections) {
  let users = 0, tasks = 0, ready = 0, errors = 0;
  for (const s of sections || []) {
    users += 1;
    tasks += s.tasks.length;
    if (s.status === "ok" && s.userId) ready += s.tasks.length;
    else errors += s.tasks.length;
  }
  return { users, tasks, ready, errors };
}
