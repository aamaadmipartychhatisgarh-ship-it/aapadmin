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

async function empty(name) {
  const [[r]] = await conn.query(`SELECT COUNT(*) AS n FROM ${name}`);
  return r.n === 0;
}

try {
  console.log('Creating social_pages...');
  // One row per (Lok Sabha, platform) — manual logging only, no API tokens.
  await conn.query(`
    CREATE TABLE IF NOT EXISTS social_pages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lok_sabha_id INT NULL,
      lok_sabha_name VARCHAR(255) NULL,
      platform ENUM('facebook','instagram','whatsapp','youtube') NOT NULL,
      handle VARCHAR(255) NOT NULL,
      url VARCHAR(512) NULL,
      followers INT DEFAULT 0,
      managed_by_user_id INT NULL,
      is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_page (lok_sabha_id, platform, handle),
      FOREIGN KEY (lok_sabha_id) REFERENCES locations(id) ON DELETE SET NULL,
      FOREIGN KEY (managed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    )`);

  console.log('Creating social_posts (manual log)...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS social_posts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      page_id INT NULL,
      title VARCHAR(500) NULL,
      caption TEXT NULL,
      post_type ENUM('post','reel','story','video','poster') DEFAULT 'post',
      media_url VARCHAR(512) NULL,
      external_url VARCHAR(512) NULL,
      scheduled_at DATETIME NULL,
      posted_at DATETIME NULL,
      approval_status ENUM('draft','pending','approved','rejected') DEFAULT 'pending',
      views INT DEFAULT 0,
      likes INT DEFAULT 0,
      comments INT DEFAULT 0,
      shares INT DEFAULT 0,
      reach INT DEFAULT 0,
      viral TINYINT(1) DEFAULT 0,
      created_by_user_id INT NULL,
      approved_by_user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_posts_status (approval_status),
      INDEX idx_posts_page (page_id),
      INDEX idx_posts_posted (posted_at),
      FOREIGN KEY (page_id) REFERENCES social_pages(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    )`);

  console.log('Creating media_library...');
  // Photos / videos / posters that come in from teams (e.g. via WhatsApp) and can be attached to posts.
  await conn.query(`
    CREATE TABLE IF NOT EXISTS media_library (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_url VARCHAR(512) NOT NULL,
      file_name VARCHAR(255) NULL,
      kind ENUM('photo','video','poster','speech','ground_report','protest_clip','reel') DEFAULT 'photo',
      assembly_id INT NULL,
      uploaded_by_user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ml_kind (kind),
      FOREIGN KEY (assembly_id) REFERENCES locations(id) ON DELETE SET NULL,
      FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    )`);

  // ============================ SEEDS ============================
  console.log('Seeding pages — 4 platforms per Lok Sabha (12 LS × 4 = 48 pages)...');
  if (await empty('social_pages')) {
    const [lokSabhas] = await conn.query(`SELECT id, name FROM locations WHERE type='lok_sabha'`);
    const platforms = [
      { p: "facebook",  prefix: "fb.com/aap.",   base: 4000 },
      { p: "instagram", prefix: "ig.com/aap.",   base: 3000 },
      { p: "whatsapp",  prefix: "wa.me/aap-",    base: 5000 },
      { p: "youtube",   prefix: "youtube.com/@aap-", base: 1500 },
    ];
    for (const ls of lokSabhas) {
      const slug = ls.name.toLowerCase().replace(/\s+/g, "");
      for (const pf of platforms) {
        const handle = `${pf.prefix}${slug}`;
        const followers = Math.round(pf.base * (0.6 + Math.random() * 0.8));
        await conn.query(
          `INSERT IGNORE INTO social_pages (lok_sabha_id, lok_sabha_name, platform, handle, url, followers, is_active)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [ls.id, ls.name, pf.p, handle, `https://${handle}`, followers]
        );
      }
    }
    const [[c]] = await conn.query(`SELECT COUNT(*) AS n FROM social_pages`).then((r) => [r]);
    console.log(`   + ${c.n} pages`);
  }

  console.log('Seeding social_posts...');
  if (await empty('social_posts')) {
    const [pages] = await conn.query(`SELECT id FROM social_pages ORDER BY RAND() LIMIT 40`);
    const titles = [
      ["Voter awareness drive in Raipur", "post"],
      ["Youth wing meeting highlights", "reel"],
      ["Tribal welfare promise video", "video"],
      ["Education manifesto post", "post"],
      ["Women safety pledge", "post"],
      ["Booth committee inauguration", "video"],
      ["Daily party update story", "story"],
      ["Farmer rights poster", "poster"],
      ["Healthcare access campaign", "post"],
      ["Rally announcement reel", "reel"],
    ];
    const statuses = ["approved", "approved", "approved", "pending", "approved", "draft", "pending", "approved"];
    let i = 0;
    for (const p of pages) {
      const t = titles[i % titles.length];
      const status = statuses[i % statuses.length];
      const posted = status === "approved";
      const v = posted ? Math.floor(500 + Math.random() * 50000) : 0;
      const viral = v > 30000;
      await conn.query(
        `INSERT INTO social_posts (page_id, title, post_type, approval_status, posted_at, views, likes, comments, shares, reach, viral)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, t[0], t[1], status,
         posted ? new Date(Date.now() - Math.floor(Math.random() * 7 * 86400000)) : null,
         v,
         Math.floor(v * (0.03 + Math.random() * 0.05)),
         Math.floor(v * (0.005 + Math.random() * 0.01)),
         Math.floor(v * (0.002 + Math.random() * 0.005)),
         Math.floor(v * (0.6 + Math.random() * 0.4)),
         viral ? 1 : 0]
      );
      i++;
    }
    const [[c]] = await conn.query(`SELECT COUNT(*) AS n FROM social_posts`).then((r) => [r]);
    console.log(`   + ${c.n} posts`);
  }

  console.log('Done.');
} catch (err) {
  console.error('Social management schema migration failed:', err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
