import { WORKER_TYPES } from "@/lib/workerTypes";

// Universal Reports Engine — module registry (the "plugin" layer).
//
// Every module the engine can report on is described here as a pure-data
// descriptor. The engine (engine.js) turns a descriptor + user filters into a
// safe, parameterized SQL query. NOTHING is hardcoded in the engine or the UI:
// to add a new module (or a future one), add ONE descriptor object below and it
// appears in the Reports Center automatically — same filters, views, export.
//
// SECURITY: the engine only ever emits SQL fragments that come from THIS file
// (table, alias, joins, column expressions, filter columns, group-by
// expressions). All *values* from the client are bound as parameters. Client
// input can only ever *select among* keys defined here — it can never inject SQL.
//
// Descriptor shape:
//   key          unique id (also the API/UI identifier)
//   label        human label
//   icon         lucide icon name (resolved in the UI)
//   table,alias  FROM `table` alias
//   joins        static JOIN clauses (string)
//   dateField    the primary timestamp column (for time filters + time grouping)
//   scopeCols    which geo columns the base table has, for role scoping
//                (subset of ['zone_id','district_id','assembly_id']); omit = no geo scope
//   geo          true if the base table carries zone/lok_sabha/district/assembly ids
//                (enables the hierarchical location filter)
//   access       (role) => boolean — who may run this report. Default: oversight.
//   columns      [{ key, label, sql, type }]  — selectable/detail columns
//   filters      [{ key, label, type, column?, options?, optionsFrom?, existsSql? }]
//                types: enum | bool | user | search-eq | m2m (time+geo are implicit)
//                  enum/bool/user/search-eq  — column is a direct expression on the base row
//                  m2m   — many-to-many relationship (e.g. worker<->team via a
//                          join table); existsSql is a SQL fragment with a
//                          %IN% placeholder the engine fills with bound params,
//                          wrapped as `AND <existsSql>` (write it as an EXISTS(...))
//                  optionsFrom  — DB-backed option list (call_statuses | designations | teams)
//                                 instead of a hardcoded `options` array
//   searchCols   columns the universal keyword search scans (LIKE)
//   groupBy      [{ key, label, sql }] — dimensions for Summary/Chart views
//   defaultColumns  column keys shown by default
//
// Enum option lists mirror the live DB column definitions.

const ROLE_OPTIONS = [
  "super_admin", "state_admin", "zone_admin", "district_admin",
  "assembly_admin", "supervisor", "caller", "worker",
].map((v) => ({ value: v, label: v.replace(/_/g, " ") }));

// Standard time-based group-by dimensions, generated from a module's dateField.
function timeGroupBys(dateField) {
  const ist = `CONVERT_TZ(${dateField},'+00:00','+05:30')`;
  return [
    { key: "day", label: "Day", sql: `DATE(${ist})` },
    { key: "week", label: "Week", sql: `DATE_FORMAT(${ist},'%x-W%v')` },
    { key: "month", label: "Month", sql: `DATE_FORMAT(${ist},'%Y-%m')` },
    { key: "quarter", label: "Quarter", sql: `CONCAT(YEAR(${ist}),'-Q',QUARTER(${ist}))` },
    { key: "year", label: "Year", sql: `YEAR(${ist})` },
    { key: "hour", label: "Hour of day", sql: `HOUR(${ist})` },
  ];
}

export const MODULES = [
  // ---------------------------------------------------------------- CALLS ---
  {
    key: "calls",
    label: "Calls",
    icon: "PhoneCall",
    table: "calls",
    alias: "c",
    dateField: "c.called_at",
    scopeCols: ["zone_id", "district_id", "assembly_id"],
    geo: true,
    joins: `
      LEFT JOIN call_statuses cs ON cs.id = c.status_id
      LEFT JOIN users u ON u.id = c.user_id
      LEFT JOIN designations dg ON dg.id = c.designation_id
      LEFT JOIN locations dist ON dist.id = c.district_id
      LEFT JOIN locations asm ON asm.id = c.assembly_id`,
    columns: [
      { key: "id", label: "ID", sql: "c.id", type: "number" },
      { key: "person_name", label: "Person", sql: "c.person_name", type: "string" },
      { key: "phone_number", label: "Phone", sql: "c.phone_number", type: "string" },
      { key: "status", label: "Status", sql: "cs.name", type: "string" },
      { key: "sentiment", label: "Sentiment", sql: "c.sentiment", type: "string" },
      { key: "caller", label: "Caller", sql: "u.username", type: "string" },
      { key: "designation", label: "Designation", sql: "dg.name", type: "string" },
      { key: "district", label: "District", sql: "dist.name", type: "string" },
      { key: "assembly", label: "Assembly", sql: "asm.name", type: "string" },
      { key: "duration_seconds", label: "Duration (s)", sql: "c.duration_seconds", type: "number" },
      { key: "follow_up", label: "Follow-up?", sql: "c.is_follow_up_required", type: "bool" },
      { key: "follow_up_date", label: "Follow-up date", sql: "c.follow_up_date", type: "date" },
      { key: "called_at", label: "Called at", sql: "c.called_at", type: "datetime" },
    ],
    filters: [
      { key: "status_id", label: "Call status", type: "enum", column: "c.status_id", optionsFrom: "call_statuses" },
      {
        key: "sentiment", label: "Sentiment", type: "enum", column: "c.sentiment",
        options: ["positive", "negative", "neutral", "supporter", "opponent", "not_supporter"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
      },
      { key: "is_follow_up_required", label: "Follow-up required", type: "bool", column: "c.is_follow_up_required" },
      { key: "is_vip", label: "VIP", type: "bool", column: "c.is_vip" },
      { key: "user_id", label: "Caller", type: "user", column: "c.user_id" },
      { key: "designation_id", label: "Designation", type: "enum", column: "c.designation_id", optionsFrom: "designations" },
    ],
    searchCols: ["c.person_name", "c.phone_number", "c.remarks"],
    groupBy: [
      { key: "status", label: "Status", sql: "cs.name" },
      { key: "sentiment", label: "Sentiment", sql: "c.sentiment" },
      { key: "caller", label: "Caller", sql: "u.username" },
      { key: "designation", label: "Designation", sql: "dg.name" },
      { key: "district", label: "District", sql: "dist.name" },
      { key: "assembly", label: "Assembly", sql: "asm.name" },
      ...timeGroupBys("c.called_at"),
    ],
    defaultColumns: ["person_name", "phone_number", "status", "sentiment", "caller", "district", "called_at"],
  },

  // ------------------------------------------------------------- CONTACTS ---
  {
    key: "contacts",
    label: "Contacts",
    icon: "Contact",
    table: "contacts",
    alias: "c",
    dateField: "c.created_at",
    scopeCols: ["zone_id", "district_id", "assembly_id"],
    geo: true,
    // Wrong Number contacts are hidden from this (and every other) report by
    // default — same rule as every other list/queue/assignment in the app.
    // Explicitly setting the "Wrong number" filter to Yes overrides it, so
    // the Wrong Number report (below) and an admin who wants to see them
    // here both still can.
    baseWhere: "(c.is_wrong_number = 0 OR c.is_wrong_number IS NULL)",
    baseWhereOverrideFilter: "is_wrong_number",
    joins: `
      LEFT JOIN users u ON u.id = c.assigned_to_user_id
      LEFT JOIN designations dg ON dg.id = c.designation_id
      LEFT JOIN locations dist ON dist.id = c.district_id
      LEFT JOIN locations asm ON asm.id = c.assembly_id`,
    columns: [
      { key: "id", label: "ID", sql: "c.id", type: "number" },
      { key: "person_name", label: "Person", sql: "c.person_name", type: "string" },
      { key: "phone_number", label: "Phone", sql: "c.phone_number", type: "string" },
      { key: "designation", label: "Designation", sql: "dg.name", type: "string" },
      { key: "assigned_to", label: "Assigned to", sql: "u.username", type: "string" },
      { key: "district", label: "District", sql: "dist.name", type: "string" },
      { key: "assembly", label: "Assembly", sql: "asm.name", type: "string" },
      { key: "is_completed", label: "Completed?", sql: "c.is_completed", type: "bool" },
      { key: "is_wrong_number", label: "Wrong #?", sql: "c.is_wrong_number", type: "bool" },
      { key: "is_vip", label: "VIP?", sql: "c.is_vip", type: "bool" },
      { key: "follow_up_date", label: "Follow-up date", sql: "c.follow_up_date", type: "date" },
      { key: "created_at", label: "Created", sql: "c.created_at", type: "datetime" },
    ],
    filters: [
      { key: "is_completed", label: "Completed", type: "bool", column: "c.is_completed" },
      { key: "is_wrong_number", label: "Wrong number", type: "bool", column: "c.is_wrong_number" },
      { key: "is_vip", label: "VIP", type: "bool", column: "c.is_vip" },
      { key: "assigned_to_user_id", label: "Assigned caller", type: "user", column: "c.assigned_to_user_id" },
      { key: "designation_id", label: "Designation", type: "enum", column: "c.designation_id", optionsFrom: "designations" },
    ],
    searchCols: ["c.person_name", "c.phone_number", "c.address"],
    groupBy: [
      { key: "district", label: "District", sql: "dist.name" },
      { key: "assembly", label: "Assembly", sql: "asm.name" },
      { key: "designation", label: "Designation", sql: "dg.name" },
      { key: "assigned_to", label: "Assigned caller", sql: "u.username" },
      { key: "is_completed", label: "Completed", sql: "c.is_completed" },
      ...timeGroupBys("c.created_at"),
    ],
    defaultColumns: ["person_name", "phone_number", "assigned_to", "district", "is_completed", "created_at"],
  },

  // -------------------------------------------------------- WRONG NUMBERS ---
  // The dedicated report for the Wrong Number module — the inverse of the
  // Contacts module's default (baseWhere here always shows ONLY wrong
  // numbers, whereas the Contacts module always HIDES them). dateField is a
  // correlated subquery (the latest call logged "Wrong Number" for this
  // contact) rather than the new wrong_number_at column, so date-range
  // filtering works for contacts marked wrong before that column existed too.
  {
    key: "wrong_numbers",
    label: "Wrong Numbers",
    icon: "PhoneOff",
    table: "contacts",
    alias: "c",
    dateField: "(SELECT MAX(cx.called_at) FROM calls cx JOIN call_statuses csx ON csx.id = cx.status_id WHERE cx.contact_id = c.id AND csx.name = 'Wrong Number')",
    scopeCols: ["zone_id", "district_id", "assembly_id"],
    geo: true,
    baseWhere: "c.is_wrong_number = 1",
    joins: `
      LEFT JOIN users u ON u.id = c.assigned_to_user_id
      LEFT JOIN users mb ON mb.id = c.wrong_number_by
      LEFT JOIN designations dg ON dg.id = c.designation_id
      LEFT JOIN locations dist ON dist.id = c.district_id
      LEFT JOIN locations asm ON asm.id = c.assembly_id
      LEFT JOIN locations wd ON wd.id = c.ward_id`,
    columns: [
      { key: "id", label: "ID", sql: "c.id", type: "number" },
      { key: "person_name", label: "Person", sql: "c.person_name", type: "string" },
      { key: "phone_number", label: "Phone", sql: "c.phone_number", type: "string" },
      { key: "designation", label: "Designation", sql: "dg.name", type: "string" },
      { key: "district", label: "District", sql: "dist.name", type: "string" },
      { key: "assembly", label: "Assembly", sql: "asm.name", type: "string" },
      { key: "block", label: "Block", sql: "wd.name", type: "string" },
      { key: "assigned_to", label: "Assigned caller", sql: "u.username", type: "string" },
      { key: "marked_by", label: "Marked by", sql: "mb.username", type: "string" },
      { key: "reason", label: "Reason", sql: "c.wrong_number_reason", type: "string" },
      { key: "notes", label: "Notes", sql: "c.wrong_number_notes", type: "string" },
      { key: "marked_at", label: "Marked at", sql: "c.wrong_number_at", type: "datetime" },
      { key: "restored_at", label: "Restored at", sql: "c.restored_at", type: "datetime" },
    ],
    filters: [
      { key: "designation_id", label: "Designation", type: "enum", column: "c.designation_id", optionsFrom: "designations" },
      { key: "assigned_to_user_id", label: "Caller", type: "user", column: "c.assigned_to_user_id" },
      { key: "wrong_number_by", label: "Marked by", type: "user", column: "c.wrong_number_by" },
      {
        key: "wrong_number_reason", label: "Reason", type: "enum", column: "c.wrong_number_reason",
        options: ["not_in_service", "invalid_number", "belongs_to_someone_else", "number_changed", "other"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
      },
      {
        key: "team_id", label: "Team", type: "m2m", optionsFrom: "teams",
        existsSql: "EXISTS (SELECT 1 FROM team_members tmm WHERE tmm.user_id = c.assigned_to_user_id AND tmm.team_id IN (%IN%))",
      },
    ],
    searchCols: ["c.person_name", "c.phone_number"],
    groupBy: [
      { key: "district", label: "District", sql: "dist.name" },
      { key: "assembly", label: "Assembly", sql: "asm.name" },
      { key: "designation", label: "Designation", sql: "dg.name" },
      { key: "reason", label: "Reason", sql: "c.wrong_number_reason" },
      { key: "marked_by", label: "Marked by", sql: "mb.username" },
      ...timeGroupBys("(SELECT MAX(cx.called_at) FROM calls cx JOIN call_statuses csx ON csx.id = cx.status_id WHERE cx.contact_id = c.id AND csx.name = 'Wrong Number')"),
    ],
    defaultColumns: ["person_name", "phone_number", "designation", "district", "assigned_to", "marked_by", "reason", "marked_at"],
  },

  // -------------------------------------------------------------- WORKERS ---
  {
    key: "workers",
    label: "Workers",
    icon: "Users",
    table: "workers",
    alias: "w",
    dateField: "w.created_at",
    scopeCols: ["zone_id", "district_id", "assembly_id"],
    geo: true,
    joins: `
      LEFT JOIN locations dist ON dist.id = w.district_id
      LEFT JOIN locations asm ON asm.id = w.assembly_id`,
    columns: [
      { key: "id", label: "ID", sql: "w.id", type: "number" },
      { key: "name", label: "Name", sql: "w.name", type: "string" },
      { key: "mobile", label: "Mobile", sql: "w.mobile", type: "string" },
      { key: "position", label: "Position", sql: "w.position", type: "string" },
      { key: "worker_type", label: "Worker Type", sql: "w.worker_type", type: "string" },
      { key: "membership_no", label: "Membership #", sql: "w.membership_no", type: "string" },
      { key: "membership_status", label: "Membership", sql: "w.membership_status", type: "string" },
      { key: "status", label: "Status", sql: "w.status", type: "string" },
      { key: "activity_score", label: "Activity", sql: "w.activity_score", type: "number" },
      { key: "district", label: "District", sql: "dist.name", type: "string" },
      { key: "assembly", label: "Assembly", sql: "asm.name", type: "string" },
      { key: "member_since", label: "Member since", sql: "w.member_since", type: "date" },
      { key: "created_at", label: "Created", sql: "w.created_at", type: "datetime" },
    ],
    filters: [
      {
        key: "status", label: "Status", type: "enum", column: "w.status",
        options: ["active", "pending", "inactive"].map((v) => ({ value: v, label: v })),
      },
      {
        key: "membership_status", label: "Membership", type: "enum", column: "w.membership_status",
        options: ["prospect", "active", "lapsed"].map((v) => ({ value: v, label: v })),
      },
      {
        key: "worker_type", label: "Worker Type", type: "enum", column: "w.worker_type",
        options: WORKER_TYPES,
      },
      {
        key: "team_id", label: "Team", type: "m2m", optionsFrom: "teams",
        existsSql: "EXISTS (SELECT 1 FROM team_members tmm WHERE tmm.worker_id = w.id AND tmm.team_id IN (%IN%))",
      },
    ],
    searchCols: ["w.name", "w.mobile", "w.membership_no", "w.position"],
    groupBy: [
      { key: "district", label: "District", sql: "dist.name" },
      { key: "assembly", label: "Assembly", sql: "asm.name" },
      { key: "status", label: "Status", sql: "w.status" },
      { key: "membership_status", label: "Membership", sql: "w.membership_status" },
      { key: "position", label: "Position", sql: "w.position" },
      { key: "worker_type", label: "Worker Type", sql: "w.worker_type" },
      ...timeGroupBys("w.created_at"),
    ],
    defaultColumns: ["name", "mobile", "position", "membership_status", "status", "district"],
  },

  // ---------------------------------------------------------------- TASKS ---
  {
    key: "tasks",
    label: "Tasks",
    icon: "ClipboardList",
    table: "tasks",
    alias: "t",
    dateField: "t.created_at",
    scopeCols: ["district_id"],
    geo: true,
    joins: `
      LEFT JOIN users u ON u.id = t.assigned_to_user_id
      LEFT JOIN users cb ON cb.id = t.created_by_user_id
      LEFT JOIN teams tm ON tm.id = t.assigned_to_team_id
      LEFT JOIN locations dist ON dist.id = t.district_id`,
    columns: [
      { key: "id", label: "ID", sql: "t.id", type: "number" },
      { key: "title", label: "Title", sql: "t.title", type: "string" },
      { key: "priority", label: "Priority", sql: "t.priority", type: "string" },
      { key: "status", label: "Status", sql: "t.status", type: "string" },
      { key: "assigned_to", label: "Assigned to", sql: "u.username", type: "string" },
      { key: "team", label: "Team", sql: "tm.name", type: "string" },
      { key: "district", label: "District", sql: "dist.name", type: "string" },
      { key: "created_by", label: "Created by", sql: "cb.username", type: "string" },
      { key: "deadline", label: "Deadline", sql: "t.deadline", type: "date" },
      { key: "created_at", label: "Created", sql: "t.created_at", type: "datetime" },
      { key: "completed_at", label: "Completed", sql: "t.completed_at", type: "datetime" },
    ],
    filters: [
      {
        key: "status", label: "Status", type: "enum", column: "t.status",
        options: ["pending", "in_progress", "completed", "cancelled"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
      },
      {
        key: "priority", label: "Priority", type: "enum", column: "t.priority",
        options: ["low", "medium", "high", "urgent"].map((v) => ({ value: v, label: v })),
      },
      { key: "assigned_to_user_id", label: "Assigned to", type: "user", column: "t.assigned_to_user_id" },
      { key: "assigned_to_team_id", label: "Team", type: "enum", column: "t.assigned_to_team_id", optionsFrom: "teams" },
    ],
    searchCols: ["t.title", "t.description"],
    groupBy: [
      { key: "status", label: "Status", sql: "t.status" },
      { key: "priority", label: "Priority", sql: "t.priority" },
      { key: "district", label: "District", sql: "dist.name" },
      { key: "assigned_to", label: "Assigned to", sql: "u.username" },
      ...timeGroupBys("t.created_at"),
    ],
    defaultColumns: ["title", "priority", "status", "assigned_to", "deadline", "created_at"],
  },

  // ----------------------------------------------------------- COMPLAINTS ---
  {
    key: "complaints",
    label: "Complaints",
    icon: "MessageSquareWarning",
    table: "complaints",
    alias: "cp",
    dateField: "cp.created_at",
    scopeCols: ["district_id", "assembly_id"],
    geo: true,
    joins: `
      LEFT JOIN teams tm ON tm.id = cp.assigned_team_id
      LEFT JOIN locations dist ON dist.id = cp.district_id
      LEFT JOIN locations asm ON asm.id = cp.assembly_id`,
    columns: [
      { key: "id", label: "ID", sql: "cp.id", type: "number" },
      { key: "citizen_name", label: "Citizen", sql: "cp.citizen_name", type: "string" },
      { key: "citizen_phone", label: "Phone", sql: "cp.citizen_phone", type: "string" },
      { key: "type", label: "Type", sql: "cp.type", type: "string" },
      { key: "status", label: "Status", sql: "cp.status", type: "string" },
      { key: "district", label: "District", sql: "dist.name", type: "string" },
      { key: "assembly", label: "Assembly", sql: "asm.name", type: "string" },
      { key: "assigned_team", label: "Team", sql: "tm.name", type: "string" },
      { key: "created_at", label: "Created", sql: "cp.created_at", type: "datetime" },
      { key: "resolved_at", label: "Resolved", sql: "cp.resolved_at", type: "datetime" },
    ],
    filters: [
      {
        key: "type", label: "Type", type: "enum", column: "cp.type",
        options: ["water", "roads", "electricity", "ration", "other"].map((v) => ({ value: v, label: v })),
      },
      {
        key: "status", label: "Status", type: "enum", column: "cp.status",
        options: ["open", "in_progress", "resolved", "closed"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
      },
      { key: "assigned_team_id", label: "Team", type: "enum", column: "cp.assigned_team_id", optionsFrom: "teams" },
    ],
    searchCols: ["cp.citizen_name", "cp.citizen_phone", "cp.description"],
    groupBy: [
      { key: "type", label: "Type", sql: "cp.type" },
      { key: "status", label: "Status", sql: "cp.status" },
      { key: "district", label: "District", sql: "dist.name" },
      { key: "assembly", label: "Assembly", sql: "asm.name" },
      ...timeGroupBys("cp.created_at"),
    ],
    defaultColumns: ["citizen_name", "type", "status", "district", "assigned_team", "created_at"],
  },

  // ----------------------------------------------------------- ATTENDANCE ---
  {
    key: "attendance",
    label: "Attendance",
    icon: "Clock",
    table: "attendance_log",
    alias: "a",
    dateField: "a.login_at",
    access: (role) => ["super_admin", "state_admin", "zone_admin", "district_admin", "assembly_admin", "supervisor"].includes(role),
    joins: `LEFT JOIN users u ON u.id = a.user_id`,
    columns: [
      { key: "id", label: "ID", sql: "a.id", type: "number" },
      { key: "user", label: "User", sql: "u.username", type: "string" },
      { key: "role", label: "Role", sql: "u.role", type: "string" },
      { key: "login_at", label: "Login", sql: "a.login_at", type: "datetime" },
      { key: "logout_at", label: "Logout", sql: "a.logout_at", type: "datetime" },
      { key: "total_minutes", label: "Minutes", sql: "a.total_minutes", type: "number" },
    ],
    filters: [
      { key: "user_id", label: "User", type: "user", column: "a.user_id" },
    ],
    searchCols: ["u.username"],
    groupBy: [
      { key: "user", label: "User", sql: "u.username" },
      { key: "role", label: "Role", sql: "u.role" },
      ...timeGroupBys("a.login_at"),
    ],
    defaultColumns: ["user", "login_at", "logout_at", "total_minutes"],
  },

  // ---------------------------------------------------------------- USERS ---
  {
    key: "users",
    label: "Users",
    icon: "UserCog",
    table: "users",
    alias: "u",
    dateField: "u.created_at",
    access: (role) => ["super_admin", "state_admin"].includes(role),
    joins: `LEFT JOIN locations dist ON dist.id = u.home_district_id`,
    columns: [
      { key: "id", label: "ID", sql: "u.id", type: "number" },
      { key: "username", label: "Username", sql: "u.username", type: "string" },
      { key: "role", label: "Role", sql: "u.role", type: "string" },
      { key: "is_active", label: "Active?", sql: "u.is_active", type: "bool" },
      { key: "home_district", label: "Home district", sql: "dist.name", type: "string" },
      { key: "last_seen_at", label: "Last seen", sql: "u.last_seen_at", type: "datetime" },
      { key: "created_at", label: "Created", sql: "u.created_at", type: "datetime" },
    ],
    filters: [
      { key: "role", label: "Role", type: "enum", column: "u.role", options: ROLE_OPTIONS },
      { key: "is_active", label: "Active", type: "bool", column: "u.is_active" },
    ],
    searchCols: ["u.username"],
    groupBy: [
      { key: "role", label: "Role", sql: "u.role" },
      { key: "is_active", label: "Active", sql: "u.is_active" },
      { key: "home_district", label: "Home district", sql: "dist.name" },
      ...timeGroupBys("u.created_at"),
    ],
    defaultColumns: ["username", "role", "is_active", "home_district", "last_seen_at"],
  },

  // ---------------------------------------------------------------- TEAMS ---
  {
    key: "teams",
    label: "Teams",
    icon: "Network",
    table: "teams",
    alias: "tm",
    dateField: "tm.created_at",
    joins: `
      LEFT JOIN locations loc ON loc.id = tm.location_id
      LEFT JOIN workers wl ON wl.id = tm.leader_worker_id`,
    columns: [
      { key: "id", label: "ID", sql: "tm.id", type: "number" },
      { key: "name", label: "Name", sql: "tm.name", type: "string" },
      { key: "level", label: "Level", sql: "tm.level", type: "string" },
      { key: "location", label: "Location", sql: "loc.name", type: "string" },
      { key: "leader", label: "Leader", sql: "wl.name", type: "string" },
      { key: "created_at", label: "Created", sql: "tm.created_at", type: "datetime" },
    ],
    filters: [
      {
        key: "level", label: "Level", type: "enum", column: "tm.level",
        options: ["state", "zone", "lok_sabha", "district", "assembly", "ward", "mandal", "booth"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
      },
    ],
    searchCols: ["tm.name"],
    groupBy: [
      { key: "level", label: "Level", sql: "tm.level" },
      { key: "location", label: "Location", sql: "loc.name" },
      ...timeGroupBys("tm.created_at"),
    ],
    defaultColumns: ["name", "level", "location", "leader", "created_at"],
  },

  // -------------------------------------------------------- NOTIFICATIONS ---
  {
    key: "notifications",
    label: "Notifications",
    icon: "Bell",
    table: "notifications",
    alias: "n",
    dateField: "n.created_at",
    access: (role) => ["super_admin", "state_admin"].includes(role),
    joins: `LEFT JOIN users u ON u.id = n.user_id`,
    columns: [
      { key: "id", label: "ID", sql: "n.id", type: "number" },
      { key: "user", label: "User", sql: "u.username", type: "string" },
      { key: "type", label: "Type", sql: "n.type", type: "string" },
      { key: "severity", label: "Severity", sql: "n.severity", type: "string" },
      { key: "title", label: "Title", sql: "n.title", type: "string" },
      { key: "is_read", label: "Read?", sql: "n.is_read", type: "bool" },
      { key: "created_at", label: "Created", sql: "n.created_at", type: "datetime" },
    ],
    filters: [
      {
        key: "severity", label: "Severity", type: "enum", column: "n.severity",
        options: ["info", "warning", "critical"].map((v) => ({ value: v, label: v })),
      },
      { key: "is_read", label: "Read", type: "bool", column: "n.is_read" },
    ],
    searchCols: ["n.title", "n.body", "n.type"],
    groupBy: [
      { key: "type", label: "Type", sql: "n.type" },
      { key: "severity", label: "Severity", sql: "n.severity" },
      { key: "is_read", label: "Read", sql: "n.is_read" },
      ...timeGroupBys("n.created_at"),
    ],
    defaultColumns: ["user", "type", "severity", "title", "is_read", "created_at"],
  },

  // ------------------------------------------------------------- AUDIT LOG ---
  {
    key: "audit",
    label: "Audit Log",
    icon: "ScrollText",
    table: "audit_logs",
    alias: "al",
    dateField: "al.created_at",
    access: (role) => ["super_admin", "state_admin"].includes(role),
    joins: "",
    columns: [
      { key: "id", label: "ID", sql: "al.id", type: "number" },
      { key: "actor_name", label: "Actor", sql: "al.actor_name", type: "string" },
      { key: "action", label: "Action", sql: "al.action", type: "string" },
      { key: "entity_type", label: "Entity", sql: "al.entity_type", type: "string" },
      { key: "entity_id", label: "Entity ID", sql: "al.entity_id", type: "string" },
      { key: "created_at", label: "When", sql: "al.created_at", type: "datetime" },
    ],
    filters: [
      { key: "action", label: "Action", type: "search-eq", column: "al.action" },
      { key: "entity_type", label: "Entity type", type: "search-eq", column: "al.entity_type" },
    ],
    searchCols: ["al.actor_name", "al.action", "al.entity_type", "al.details"],
    groupBy: [
      { key: "action", label: "Action", sql: "al.action" },
      { key: "entity_type", label: "Entity type", sql: "al.entity_type" },
      { key: "actor_name", label: "Actor", sql: "al.actor_name" },
      ...timeGroupBys("al.created_at"),
    ],
    defaultColumns: ["actor_name", "action", "entity_type", "entity_id", "created_at"],
  },

  // Media modules: default (oversight-only) access, same as calls/contacts/
  // workers — the /api/reports route itself gates to OVERSIGHT_ROLES before
  // any module-level `access` is even consulted, so press_media (who can see
  // the Media Center page but aren't an oversight role) can't reach the
  // Reports Center regardless of what a module declares here; the Media
  // Dashboard's own KPI numbers are fetched through a separate endpoint
  // gated by canAccessMedia instead, precisely so press_media still works.
  // ----------------------------------------------------------- PRESS NOTES ---
  {
    key: "press_notes",
    label: "Press Notes & Coverage",
    icon: "Newspaper",
    table: "press_notes",
    alias: "pn",
    dateField: "pn.coverage_date",
    joins: `
      LEFT JOIN newspapers np ON np.id = pn.newspaper_id
      LEFT JOIN users cb ON cb.id = pn.created_by_user_id`,
    columns: [
      { key: "id", label: "ID", sql: "pn.id", type: "number" },
      { key: "title", label: "Title", sql: "pn.title", type: "string" },
      { key: "newspaper", label: "Newspaper", sql: "np.name", type: "string" },
      { key: "kind", label: "Type", sql: "pn.kind", type: "string" },
      { key: "sentiment", label: "Sentiment", sql: "pn.sentiment", type: "string" },
      { key: "created_by", label: "Logged by", sql: "cb.username", type: "string" },
      { key: "coverage_date", label: "Coverage date", sql: "pn.coverage_date", type: "date" },
      { key: "created_at", label: "Logged at", sql: "pn.created_at", type: "datetime" },
    ],
    filters: [
      {
        key: "kind", label: "Type", type: "enum", column: "pn.kind",
        options: ["press_note", "newspaper_scan", "article_pdf"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
      },
      {
        key: "sentiment", label: "Sentiment", type: "enum", column: "pn.sentiment",
        options: ["positive", "neutral", "negative"].map((v) => ({ value: v, label: v })),
      },
    ],
    searchCols: ["pn.title", "pn.summary"],
    groupBy: [
      { key: "kind", label: "Type", sql: "pn.kind" },
      { key: "sentiment", label: "Sentiment", sql: "pn.sentiment" },
      { key: "newspaper", label: "Newspaper", sql: "np.name" },
      ...timeGroupBys("pn.coverage_date"),
    ],
    defaultColumns: ["title", "newspaper", "kind", "sentiment", "coverage_date"],
  },

  // -------------------------------------------------------------- DEBATES ---
  {
    key: "debates",
    label: "TV Debates",
    icon: "Tv",
    table: "debates",
    alias: "de",
    dateField: "de.debate_date",
    joins: `LEFT JOIN news_channels ch ON ch.id = de.channel_id`,
    columns: [
      { key: "id", label: "ID", sql: "de.id", type: "number" },
      { key: "topic", label: "Topic", sql: "de.topic", type: "string" },
      { key: "channel", label: "Channel", sql: "ch.name", type: "string" },
      { key: "status", label: "Status", sql: "de.status", type: "string" },
      { key: "viral_score", label: "Viral score", sql: "de.viral_score", type: "number" },
      { key: "debate_date", label: "Debate date", sql: "de.debate_date", type: "date" },
      { key: "created_at", label: "Logged at", sql: "de.created_at", type: "datetime" },
    ],
    filters: [
      {
        key: "status", label: "Status", type: "enum", column: "de.status",
        options: ["scheduled", "live", "aired", "cancelled"].map((v) => ({ value: v, label: v })),
      },
    ],
    searchCols: ["de.topic", "de.talking_points"],
    groupBy: [
      { key: "status", label: "Status", sql: "de.status" },
      { key: "channel", label: "Channel", sql: "ch.name" },
      ...timeGroupBys("de.debate_date"),
    ],
    defaultColumns: ["topic", "channel", "status", "debate_date"],
  },

  // ------------------------------------------------------- PRESS CONFERENCES ---
  {
    key: "press_conferences",
    label: "Press Conferences",
    icon: "Mic",
    table: "press_conferences",
    alias: "pc",
    dateField: "pc.conference_date",
    joins: "",
    columns: [
      { key: "id", label: "ID", sql: "pc.id", type: "number" },
      { key: "title", label: "Title", sql: "pc.title", type: "string" },
      { key: "venue", label: "Venue", sql: "pc.venue", type: "string" },
      { key: "status", label: "Status", sql: "pc.status", type: "string" },
      { key: "conference_date", label: "Conference date", sql: "pc.conference_date", type: "datetime" },
      { key: "created_at", label: "Logged at", sql: "pc.created_at", type: "datetime" },
    ],
    filters: [
      {
        key: "status", label: "Status", type: "enum", column: "pc.status",
        options: ["scheduled", "completed", "cancelled"].map((v) => ({ value: v, label: v })),
      },
    ],
    searchCols: ["pc.title", "pc.agenda"],
    groupBy: [
      { key: "status", label: "Status", sql: "pc.status" },
      { key: "venue", label: "Venue", sql: "pc.venue" },
      ...timeGroupBys("pc.conference_date"),
    ],
    defaultColumns: ["title", "venue", "status", "conference_date"],
  },
];

export function getModule(key) {
  return MODULES.find((m) => m.key === key) || null;
}

// Lightweight list for the module picker (no SQL exposed).
export function moduleList() {
  return MODULES.map((m) => ({ key: m.key, label: m.label, icon: m.icon, geo: !!m.geo }));
}
