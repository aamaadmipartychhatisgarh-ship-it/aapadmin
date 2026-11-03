import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";

// Projects module: Department Projects and MLA Fund Projects, each with ITS OWN stage list (master data),
// a shared status master, and an append-only follow-up history.
//   pj_stages     - master: stages per project type (a stage belongs to exactly one type)
//   pj_statuses   - master: statuses; skips_stage = 1 marks "No Budget" (no stage is asked for or changed)
//   pj_projects   - the project (type fixed at creation) + its CURRENT status/stage and Next Follow-up
//   pj_followups  - one row per submitted follow-up; never updated or deleted. The "latest" remark is always
//                   read from here by the saved timestamp, never by position.
export const PROJECTS_PAGE_KEY = "projects";
export const PROJECT_TYPES = ["department", "mla_fund"];
export const TYPE_LABEL = { department: "Department Project", mla_fund: "MLA Fund Project" };

// Seed data (inserted once into the master tables; the UI only ever reads the tables).
const DEPARTMENT_STAGES = ["Proposal", "Tender", "Tender Award", "Work Award", "Construction Started", "Inauguration", "Construction in Progress", "Construction Completed", "Completion Issued"];
const MLA_FUND_STAGES = ["Proposal", "Estimate", "Recommendation", "Administrative Approval", "Technical Sanction", "Tender", "Tender Award", "Work Order", "Construction Started", "Inauguration", "Construction in Progress", "Inspection", "Construction Completed", "Completion Issued", "Saving Added"];
const STATUSES = [["Follow-up", 0], ["Call by Sir", 0], ["Stuck", 0], ["In Progress", 0], ["Completed", 0], ["No Budget", 1]];

let ensured = null;
export function ensureProjectsSchema() {
  if (!ensured) {
    ensured = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS pj_stages (
        id INT AUTO_INCREMENT PRIMARY KEY, project_type ENUM('department','mla_fund') NOT NULL, name VARCHAR(120) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0, is_active TINYINT(1) NOT NULL DEFAULT 1, UNIQUE KEY uq_pj_stage (project_type, name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await query(`CREATE TABLE IF NOT EXISTS pj_statuses (
        id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, skips_stage TINYINT(1) NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0, is_active TINYINT(1) NOT NULL DEFAULT 1, UNIQUE KEY uq_pj_status (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await query(`CREATE TABLE IF NOT EXISTS pj_projects (
        id INT AUTO_INCREMENT PRIMARY KEY, project_type ENUM('department','mla_fund') NOT NULL, name VARCHAR(255) NOT NULL,
        description TEXT NULL, status_id INT NULL, stage_id INT NULL,
        next_followup_date DATE NULL, next_followup_remark VARCHAR(1000) NULL, created_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_pj_type (project_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await query(`CREATE TABLE IF NOT EXISTS pj_followups (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, project_id INT NOT NULL, project_type ENUM('department','mla_fund') NOT NULL,
        status_id INT NULL, stage_id INT NULL, remark VARCHAR(2000) NOT NULL,
        next_followup_date DATE NULL, next_followup_remark VARCHAR(1000) NULL, submission_key VARCHAR(64) NULL,
        created_by INT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_pj_fu_key (project_id, submission_key), KEY idx_pj_fu_project (project_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      const seed = async (type, list) => { for (let i = 0; i < list.length; i++) await query("INSERT IGNORE INTO pj_stages (project_type, name, sort_order) VALUES (?,?,?)", [type, list[i], (i + 1) * 10]); };
      const [{ n }] = await query("SELECT COUNT(*) AS n FROM pj_stages");
      if (!n) { await seed("department", DEPARTMENT_STAGES); await seed("mla_fund", MLA_FUND_STAGES); }
      const [{ m }] = await query("SELECT COUNT(*) AS m FROM pj_statuses");
      if (!m) for (let i = 0; i < STATUSES.length; i++) await query("INSERT IGNORE INTO pj_statuses (name, skips_stage, sort_order) VALUES (?,?,?)", [STATUSES[i][0], STATUSES[i][1], (i + 1) * 10]);
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

export async function projectsGate(session) {
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!(await pageAllowed(session, PROJECTS_PAGE_KEY, isAdmin(session)))) return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  return null;
}

export const parseId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && String(n) === String(v).trim() ? n : null; };
export const validDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v).getTime());

// Project row + names + LATEST follow-up (by saved timestamp, id as tiebreak only for identical timestamps).
export const PROJECT_SELECT = `
  SELECT p.id, p.project_type, p.name, p.description, p.status_id, st.name AS status_name, COALESCE(st.skips_stage,0) AS status_skips_stage,
         p.stage_id, sg.name AS stage_name, DATE_FORMAT(p.next_followup_date,'%Y-%m-%d') AS next_followup_date, p.next_followup_remark,
         lf.remark AS latest_remark, DATE_FORMAT(lf.created_at,'%Y-%m-%d %H:%i:%s') AS latest_remark_at,
         (SELECT COUNT(*) FROM pj_followups f WHERE f.project_id = p.id) AS followup_count
    FROM pj_projects p
    LEFT JOIN pj_statuses st ON st.id = p.status_id
    LEFT JOIN pj_stages sg ON sg.id = p.stage_id
    LEFT JOIN pj_followups lf ON lf.id = (SELECT f2.id FROM pj_followups f2 WHERE f2.project_id = p.id ORDER BY f2.created_at DESC, f2.id DESC LIMIT 1)`;
