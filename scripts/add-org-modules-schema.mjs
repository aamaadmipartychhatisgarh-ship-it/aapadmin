import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aapadmin',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

async function tableEmpty(name) {
  const [[r]] = await conn.query(`SELECT COUNT(*) AS n FROM ${name}`);
  return r.n === 0;
}

try {
  // ---------------------------------------------------------------- WORKERS
  console.log('Creating workers...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS workers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      mobile VARCHAR(20),
      photo_url VARCHAR(512) NULL,
      address TEXT NULL,
      zone_id INT NULL,
      lok_sabha_id INT NULL,
      district_id INT NULL,
      assembly_id INT NULL,
      ward_id INT NULL,
      booth_id INT NULL,
      position VARCHAR(255) NULL,
      skills VARCHAR(512) NULL,
      activity_score INT NOT NULL DEFAULT 0,
      status ENUM('active','inactive') NOT NULL DEFAULT 'active',
      aadhaar_ref VARCHAR(64) NULL,
      user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_workers_district (district_id),
      INDEX idx_workers_assembly (assembly_id),
      INDEX idx_workers_status (status),
      FOREIGN KEY (zone_id) REFERENCES locations(id) ON DELETE SET NULL,
      FOREIGN KEY (district_id) REFERENCES locations(id) ON DELETE SET NULL,
      FOREIGN KEY (assembly_id) REFERENCES locations(id) ON DELETE SET NULL
    )`);

  // ---------------------------------------------------------------- TEAMS
  console.log('Creating teams + team_members...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      level ENUM('state','zone','lok_sabha','district','assembly','ward','mandal','booth') NOT NULL,
      location_id INT NULL,
      leader_worker_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_teams_level (level),
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
      FOREIGN KEY (leader_worker_id) REFERENCES workers(id) ON DELETE SET NULL
    )`);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS team_members (
      id INT AUTO_INCREMENT PRIMARY KEY,
      team_id INT NOT NULL,
      worker_id INT NOT NULL,
      role_in_team VARCHAR(120) NULL,
      added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_team_worker (team_id, worker_id),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
    )`);

  // ---------------------------------------------------------------- TASKS
  console.log('Creating tasks...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      priority ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
      status ENUM('pending','in_progress','completed','cancelled') NOT NULL DEFAULT 'pending',
      deadline DATE NULL,
      assigned_to_user_id INT NULL,
      assigned_to_team_id INT NULL,
      district_id INT NULL,
      created_by_user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL,
      INDEX idx_tasks_status (status),
      INDEX idx_tasks_assignee (assigned_to_user_id),
      FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_to_team_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (district_id) REFERENCES locations(id) ON DELETE SET NULL
    )`);

  // ---------------------------------------------------------------- COMPLAINTS
  console.log('Creating complaints...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id INT AUTO_INCREMENT PRIMARY KEY,
      citizen_name VARCHAR(255) NOT NULL,
      citizen_phone VARCHAR(20) NULL,
      type ENUM('water','roads','electricity','ration','other') NOT NULL DEFAULT 'other',
      description TEXT NULL,
      district_id INT NULL,
      assembly_id INT NULL,
      status ENUM('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
      assigned_team_id INT NULL,
      resolution_notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMP NULL,
      INDEX idx_complaints_status (status),
      INDEX idx_complaints_type (type),
      FOREIGN KEY (district_id) REFERENCES locations(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_team_id) REFERENCES teams(id) ON DELETE SET NULL
    )`);

  // ---------------------------------------------------------------- NOTIFICATIONS
  console.log('Creating notifications...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,                 -- NULL = broadcast to all admins/supervisors
      type VARCHAR(64) NOT NULL,        -- weak_booth, inactive_worker, pending_task, meeting, low_calling
      severity ENUM('info','warning','critical') NOT NULL DEFAULT 'info',
      title VARCHAR(255) NOT NULL,
      body TEXT NULL,
      link VARCHAR(512) NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notif_user (user_id, is_read),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

  // ---------------------------------------------------------------- TRAINING
  console.log('Creating training_modules + training_progress...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS training_modules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      category ENUM('calling','booth','social_media','organization') NOT NULL,
      description TEXT NULL,
      video_url VARCHAR(512) NULL,
      pdf_url VARCHAR(512) NULL,
      duration_min INT NULL,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS training_progress (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      module_id INT NOT NULL,
      progress_pct INT NOT NULL DEFAULT 0,
      completed_at TIMESTAMP NULL,
      UNIQUE KEY uniq_user_module (user_id, module_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (module_id) REFERENCES training_modules(id) ON DELETE CASCADE
    )`);

  // ---------------------------------------------------------------- BADGES
  console.log('Creating badges + worker_badges...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS badges (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE,
      description VARCHAR(255) NULL,
      icon VARCHAR(64) NULL,
      color VARCHAR(32) NULL
    )`);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS worker_badges (
      id INT AUTO_INCREMENT PRIMARY KEY,
      worker_id INT NOT NULL,
      badge_id INT NOT NULL,
      awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_worker_badge (worker_id, badge_id),
      FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
      FOREIGN KEY (badge_id) REFERENCES badges(id) ON DELETE CASCADE
    )`);

  // ---------------------------------------------------------------- SOCIAL ANALYTICS
  console.log('Creating social_analytics...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS social_analytics (
      id INT AUTO_INCREMENT PRIMARY KEY,
      platform ENUM('facebook','instagram','whatsapp') NOT NULL,
      metric_date DATE NOT NULL,
      views INT DEFAULT 0,
      reach INT DEFAULT 0,
      followers INT DEFAULT 0,
      engagement INT DEFAULT 0,
      viral_posts INT DEFAULT 0,
      UNIQUE KEY uniq_platform_date (platform, metric_date)
    )`);

  // =================================================================== SEEDS
  console.log('Seeding sample data...');

  // Districts/assemblies for placement
  const [districts] = await conn.query(`SELECT id, name FROM locations WHERE type='district' ORDER BY name LIMIT 6`);
  const [assemblies] = await conn.query(`SELECT id, name, parent_id FROM locations WHERE type='assembly' LIMIT 30`);
  const distId = (i) => districts[i % districts.length]?.id || null;

  // Workers
  if (await tableEmpty('workers')) {
    const positions = ['Booth President', 'Block Worker', 'District Coordinator', 'Social Media Volunteer', 'Youth Wing Member'];
    const skillsList = ['Door-to-door', 'Social media', 'Public speaking', 'Data entry', 'Event mgmt'];
    const firstNames = ['Rahul','Priya','Amit','Neha','Sanjay','Vikram','Ravi','Sunita','Manoj','Kavita','Deepak','Anita','Suresh','Pooja','Arjun','Meena','Rajesh','Shilpa','Vivek','Geeta'];
    const lastNames = ['Sharma','Verma','Singh','Gupta','Kumar','Patel','Sahu','Yadav','Tiwari','Mishra'];
    const rows = [];
    for (let i = 0; i < 40; i++) {
      const name = `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`;
      const a = assemblies[i % Math.max(1, assemblies.length)];
      rows.push([
        name,
        '98' + String(1000000 + i * 137).slice(0, 8),
        `Ward ${1 + (i % 20)}, ${districts[i % districts.length]?.name || 'Raipur'}`,
        distId(i),
        a ? a.id : null,
        positions[i % positions.length],
        skillsList[i % skillsList.length] + ', ' + skillsList[(i + 2) % skillsList.length],
        Math.floor(20 + Math.random() * 80),
        Math.random() > 0.25 ? 'active' : 'inactive',
      ]);
    }
    for (const r of rows) {
      await conn.query(
        `INSERT INTO workers (name, mobile, address, district_id, assembly_id, position, skills, activity_score, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, r
      );
    }
    console.log(`   + ${rows.length} workers`);
  }

  // Teams
  if (await tableEmpty('teams')) {
    await conn.query(`INSERT INTO teams (name, level) VALUES ('Chhattisgarh State Team', 'state')`);
    const [zones] = await conn.query(`SELECT id, name FROM locations WHERE type='zone'`);
    for (const z of zones) {
      await conn.query(`INSERT INTO teams (name, level, location_id) VALUES (?, 'zone', ?)`, [`${z.name} Zone Team`, z.id]);
    }
    for (const d of districts) {
      await conn.query(`INSERT INTO teams (name, level, location_id) VALUES (?, 'district', ?)`, [`${d.name} District Team`, d.id]);
    }
    // Assign some members
    const [allWorkers] = await conn.query(`SELECT id FROM workers`);
    const [allTeams] = await conn.query(`SELECT id FROM teams`);
    for (let i = 0; i < allWorkers.length; i++) {
      const team = allTeams[i % allTeams.length];
      await conn.query(`INSERT IGNORE INTO team_members (team_id, worker_id) VALUES (?, ?)`, [team.id, allWorkers[i].id]);
    }
    console.log(`   + ${allTeams.length} teams with members`);
  }

  // Tasks
  if (await tableEmpty('tasks')) {
    const [[admin]] = await conn.query(`SELECT id FROM users WHERE role IN ('super_admin','admin') LIMIT 1`);
    const taskTitles = [
      ['Booth committee formation - Ward 12', 'high', 'in_progress'],
      ['Voter list verification drive', 'urgent', 'pending'],
      ['Distribute party manifesto', 'medium', 'completed'],
      ['Organize youth meeting', 'medium', 'pending'],
      ['Social media campaign launch', 'high', 'in_progress'],
      ['Weekly worker attendance report', 'low', 'completed'],
      ['Identify weak booths in district', 'high', 'pending'],
    ];
    for (const [title, priority, status] of taskTitles) {
      await conn.query(
        `INSERT INTO tasks (title, priority, status, deadline, district_id, created_by_user_id, completed_at)
         VALUES (?, ?, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, ?, ?)`,
        [title, priority, status, Math.floor(Math.random() * 14) - 3, distId(Math.floor(Math.random() * 5)), admin?.id || null,
         status === 'completed' ? new Date() : null]
      );
    }
    console.log(`   + ${taskTitles.length} tasks`);
  }

  // Complaints
  if (await tableEmpty('complaints')) {
    const types = ['water','roads','electricity','ration','other'];
    const names = ['Ramesh Sahu','Geeta Devi','Mohan Lal','Sita Bai','Anil Kumar','Pushpa Verma','Dinesh Yadav','Kamla Bai'];
    const statuses = ['open','in_progress','resolved','closed'];
    for (let i = 0; i < 12; i++) {
      await conn.query(
        `INSERT INTO complaints (citizen_name, citizen_phone, type, description, district_id, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [names[i % names.length], '99' + String(1000000 + i * 271).slice(0,8), types[i % types.length],
         'Reported civic issue requiring attention.', distId(i), statuses[i % statuses.length]]
      );
    }
    console.log('   + 12 complaints');
  }

  // Training modules
  if (await tableEmpty('training_modules')) {
    const mods = [
      ['Calling Basics & Etiquette', 'calling', 25],
      ['Handling Difficult Calls', 'calling', 18],
      ['Booth Management 101', 'booth', 30],
      ['Voter List & EVM Awareness', 'booth', 22],
      ['Social Media Best Practices', 'social_media', 20],
      ['Creating Viral Content', 'social_media', 15],
      ['Party Ideology & Vision', 'organization', 40],
      ['Volunteer Coordination', 'organization', 28],
    ];
    for (let i = 0; i < mods.length; i++) {
      await conn.query(
        `INSERT INTO training_modules (title, category, description, duration_min, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [mods[i][0], mods[i][1], 'Training material for organizational capacity building.', mods[i][2], i]
      );
    }
    console.log(`   + ${mods.length} training modules`);
  }

  // Badges
  if (await tableEmpty('badges')) {
    const badges = [
      ['Top Caller', 'Most calls in a week', 'phone', '#164FA3'],
      ['Century Club', '100+ connected calls', 'award', '#FCB712'],
      ['Booth Champion', 'Strongest booth performance', 'shield', '#10B981'],
      ['Early Bird', 'Consistent morning activity', 'sunrise', '#F59E0B'],
      ['Team Player', 'Active in 3+ teams', 'users', '#8B5CF6'],
    ];
    for (const b of badges) {
      await conn.query(`INSERT INTO badges (name, description, icon, color) VALUES (?, ?, ?, ?)`, b);
    }
    // Award a few
    const [topWorkers] = await conn.query(`SELECT id FROM workers ORDER BY activity_score DESC LIMIT 5`);
    const [badgeRows] = await conn.query(`SELECT id FROM badges`);
    for (let i = 0; i < topWorkers.length; i++) {
      await conn.query(`INSERT IGNORE INTO worker_badges (worker_id, badge_id) VALUES (?, ?)`, [topWorkers[i].id, badgeRows[i % badgeRows.length].id]);
    }
    console.log(`   + ${badges.length} badges, awarded to top workers`);
  }

  // Social analytics — 30 days of mock data per platform
  if (await tableEmpty('social_analytics')) {
    const platforms = ['facebook','instagram','whatsapp'];
    const base = { facebook: 50000, instagram: 35000, whatsapp: 80000 };
    for (const p of platforms) {
      for (let d = 29; d >= 0; d--) {
        const growth = (29 - d) * 0.01;
        await conn.query(
          `INSERT INTO social_analytics (platform, metric_date, views, reach, followers, engagement, viral_posts)
           VALUES (?, DATE_SUB(CURDATE(), INTERVAL ? DAY), ?, ?, ?, ?, ?)`,
          [p, d,
           Math.round(base[p] * (1 + growth) * (0.8 + Math.random() * 0.4)),
           Math.round(base[p] * 0.6 * (1 + growth) * (0.8 + Math.random() * 0.4)),
           Math.round(base[p] * 0.3 * (1 + growth)),
           Math.round(base[p] * 0.08 * (0.8 + Math.random() * 0.4)),
           Math.random() > 0.85 ? 1 : 0]
        );
      }
    }
    console.log('   + 90 days of social analytics (3 platforms × 30 days)');
  }

  console.log('Done. All module tables created & seeded.');
} catch (err) {
  console.error('Schema migration failed:', err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
