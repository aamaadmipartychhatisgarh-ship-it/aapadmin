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
  console.log('Creating newspapers, press_notes, news_channels, debates, press_conferences, journalists, journalist_invites, spokespersons, debate_assignments...');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS newspapers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      circulation VARCHAR(50) NULL,
      contact_email VARCHAR(255) NULL,
      contact_phone VARCHAR(50) NULL,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS press_notes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(500) NOT NULL,
      summary TEXT NULL,
      file_url VARCHAR(512) NULL,
      kind ENUM('press_note','newspaper_scan','article_pdf') DEFAULT 'press_note',
      newspaper_id INT NULL,
      coverage_date DATE NULL,
      sentiment ENUM('positive','neutral','negative') NULL,
      created_by_user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pn_date (coverage_date),
      FOREIGN KEY (newspaper_id) REFERENCES newspapers(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    )`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS news_channels (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      contact_email VARCHAR(255) NULL,
      contact_phone VARCHAR(50) NULL,
      tone ENUM('supportive','neutral','opposing','unknown') DEFAULT 'unknown',
      sort_order INT DEFAULT 0
    )`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS debates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      channel_id INT NULL,
      topic VARCHAR(500) NOT NULL,
      debate_date DATE NOT NULL,
      debate_time TIME NULL,
      brief_pdf_url VARCHAR(512) NULL,
      talking_points TEXT NULL,
      opposition_counter TEXT NULL,
      status ENUM('scheduled','live','aired','cancelled') DEFAULT 'scheduled',
      viral_score INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_deb_date (debate_date),
      FOREIGN KEY (channel_id) REFERENCES news_channels(id) ON DELETE SET NULL
    )`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS spokespersons (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      mobile VARCHAR(50) NULL,
      expertise VARCHAR(255) NULL,
      languages VARCHAR(255) NULL,
      photo_url VARCHAR(512) NULL,
      is_active TINYINT(1) DEFAULT 1
    )`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS debate_assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      debate_id INT NOT NULL,
      spokesperson_id INT NOT NULL,
      whatsapp_alert_sent TINYINT(1) DEFAULT 0,
      UNIQUE KEY uniq_da (debate_id, spokesperson_id),
      FOREIGN KEY (debate_id) REFERENCES debates(id) ON DELETE CASCADE,
      FOREIGN KEY (spokesperson_id) REFERENCES spokespersons(id) ON DELETE CASCADE
    )`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS press_conferences (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(500) NOT NULL,
      conference_date DATETIME NOT NULL,
      venue VARCHAR(500) NULL,
      agenda TEXT NULL,
      status ENUM('scheduled','completed','cancelled') DEFAULT 'scheduled',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pc_date (conference_date)
    )`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS journalists (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      outlet VARCHAR(255) NULL,
      mobile VARCHAR(50) NULL,
      email VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS journalist_invites (
      id INT AUTO_INCREMENT PRIMARY KEY,
      conference_id INT NOT NULL,
      journalist_id INT NOT NULL,
      whatsapp_sent TINYINT(1) DEFAULT 0,
      call_reminder_sent TINYINT(1) DEFAULT 0,
      attended TINYINT(1) DEFAULT 0,
      UNIQUE KEY uniq_inv (conference_id, journalist_id),
      FOREIGN KEY (conference_id) REFERENCES press_conferences(id) ON DELETE CASCADE,
      FOREIGN KEY (journalist_id) REFERENCES journalists(id) ON DELETE CASCADE
    )`);

  // =========================== SEEDS ==========================
  console.log('Seeding sample data...');

  if (await tableEmpty('newspapers')) {
    const papers = [
      ['Dainik Bhaskar', '5L+'],
      ['Patrika', '4L+'],
      ['Nai Dunia', '3L+'],
      ['Hari Bhoomi', '2L+'],
      ['Deshbandhu', '1.5L+'],
    ];
    for (let i = 0; i < papers.length; i++) {
      await conn.query(`INSERT INTO newspapers (name, circulation, sort_order) VALUES (?, ?, ?)`, [papers[i][0], papers[i][1], i]);
    }
    console.log(`   + ${papers.length} newspapers`);
  }

  if (await tableEmpty('news_channels')) {
    const channels = [
      ['IBC24', 'supportive'],
      ['News18 Chhattisgarh', 'neutral'],
      ['Zee Madhya Pradesh Chhattisgarh', 'neutral'],
      ['DD Chhattisgarh', 'neutral'],
      ['Sahara Samay CG', 'supportive'],
    ];
    for (let i = 0; i < channels.length; i++) {
      await conn.query(`INSERT INTO news_channels (name, tone, sort_order) VALUES (?, ?, ?)`, [channels[i][0], channels[i][1], i]);
    }
    console.log(`   + ${channels.length} news channels`);
  }

  if (await tableEmpty('spokespersons')) {
    const sps = [
      ['Dr. Sandeep Pathak', 'Policy, Economy', 'Hindi, English'],
      ['Priyanka Kakkar', 'Women, Education', 'Hindi, English'],
      ['Ahilya P. Shukla', 'Health, Welfare', 'Hindi'],
      ['Komal Hupendi', 'Agriculture, Rural', 'Hindi, Chhattisgarhi'],
      ['Mahesh Sahu', 'Tribal Affairs', 'Hindi, Chhattisgarhi'],
      ['Rajeev Sharma', 'Youth, Employment', 'Hindi, English'],
      ['Anita Verma', 'Women, Health', 'Hindi'],
      ['Devendra Yadav', 'Politics, Governance', 'Hindi, English'],
      ['Sushil Anand', 'Energy, Infrastructure', 'Hindi'],
      ['Manish Kunjam', 'Tribal, Bastar', 'Hindi, Chhattisgarhi, English'],
      ['Sapna Patel', 'Education', 'Hindi'],
      ['Rakesh Tikait', 'Farmers', 'Hindi'],
      ['Vinay Mishra', 'Law, Constitution', 'Hindi, English'],
      ['Sangita Sahu', 'Social Justice', 'Hindi, Chhattisgarhi'],
      ['Pankaj Singh', 'Defence, Security', 'Hindi, English'],
    ];
    for (const s of sps) {
      await conn.query(`INSERT INTO spokespersons (name, expertise, languages) VALUES (?, ?, ?)`, s);
    }
    console.log(`   + ${sps.length} spokespersons`);
  }

  if (await tableEmpty('journalists')) {
    const jl = [
      ['Anil Sharma', 'Dainik Bhaskar'],
      ['Meena Verma', 'IBC24'],
      ['Rakesh Patil', 'Patrika'],
      ['Sneha Iyer', 'News18 CG'],
      ['Arjun Gupta', 'Hari Bhoomi'],
      ['Pooja Singh', 'Zee MPCG'],
      ['Vikas Tiwari', 'Nai Dunia'],
      ['Kavita Mishra', 'Deshbandhu'],
    ];
    for (const j of jl) {
      await conn.query(`INSERT INTO journalists (name, outlet) VALUES (?, ?)`, j);
    }
    console.log(`   + ${jl.length} journalists`);
  }

  if (await tableEmpty('debates')) {
    const [chans] = await conn.query(`SELECT id FROM news_channels`);
    const topics = [
      ['Rural employment in Chhattisgarh', 0],
      ['Healthcare access in tribal areas', 1],
      ['Education reform debate', 2],
      ['Farmer income & MSP', 0],
      ['Booth-level political organization', 1],
    ];
    for (let i = 0; i < topics.length; i++) {
      await conn.query(
        `INSERT INTO debates (channel_id, topic, debate_date, debate_time, status, viral_score)
         VALUES (?, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY), '20:00:00', ?, ?)`,
        [chans[topics[i][1] % chans.length].id, topics[i][0], i - 2, i < 2 ? 'aired' : 'scheduled', i < 2 ? Math.floor(Math.random() * 100) : 0]
      );
    }
    console.log(`   + ${topics.length} debates`);
  }

  if (await tableEmpty('press_conferences')) {
    const titles = [
      ['Monthly briefing — November', 5],
      ['Education policy stance', 12],
      ['Farmer issues round-table', 20],
    ];
    for (const t of titles) {
      await conn.query(
        `INSERT INTO press_conferences (title, conference_date, venue, status)
         VALUES (?, DATE_ADD(NOW(), INTERVAL ? DAY), 'AAP State Office, Raipur', 'scheduled')`,
        [t[0], t[1]]
      );
    }
    console.log(`   + ${titles.length} press conferences`);
  }

  if (await tableEmpty('press_notes')) {
    const [[paperRow]] = await conn.query(`SELECT id FROM newspapers LIMIT 1`).then((r) => [r]);
    const samples = [
      ['Party announces voter awareness campaign', 'positive'],
      ['Statement on farmer protests', 'neutral'],
      ['Reaction to state budget', 'negative'],
    ];
    for (const s of samples) {
      await conn.query(
        `INSERT INTO press_notes (title, summary, kind, newspaper_id, coverage_date, sentiment)
         VALUES (?, 'Auto-seeded press note for demo.', 'press_note', ?, CURDATE(), ?)`,
        [s[0], paperRow.id, s[1]]
      );
    }
    console.log(`   + ${samples.length} press notes`);
  }

  console.log('Done.');
} catch (err) {
  console.error('Media schema migration failed:', err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
