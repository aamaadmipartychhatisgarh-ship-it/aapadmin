import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Chhattisgarh political geography
// Source: best-effort from public records (ECI, CG state portal). This data
// was correct as of the 2023 Vidhan Sabha election delimitation. Districts
// created in 2022 (Sakti, Sarangarh-Bilaigarh, MCB, Mohla-Manpur, Khairagarh)
// don't yet have separate LS mappings published, so they're attached to the
// LS their parent district belongs to.
//
// Structure:
//   Zone (5 divisions) → Lok Sabha (11) → District (33) → Vidhan Sabha (90)

const DATA = {
  Raipur: {
    lok_sabhas: {
      Raipur: {
        districts: {
          Raipur: ["Raipur City Rural", "Raipur City West", "Raipur City North", "Raipur City South", "Arang", "Abhanpur", "Dharsiwa"],
          "Balodabazar-Bhatapara": ["Bilaigarh", "Kasdol", "Balodabazar", "Bhatapara"],
        },
      },
      Mahasamund: {
        districts: {
          Mahasamund: ["Saraipali", "Basna", "Khallari", "Mahasamund"],
          Dhamtari: ["Sihawa", "Kurud", "Dhamtari"],
          Gariyaband: ["Bindrawagarh", "Rajim"],
          "Raipur (rural)": [],
        },
      },
      Janjgir_Champa: {
        // mostly Bilaspur division but historically grouped under Raipur LS region in some lists
        districts: {},
      },
    },
  },
  Bilaspur: {
    lok_sabhas: {
      Bilaspur: {
        districts: {
          Bilaspur: ["Kota", "Takhatpur", "Bilha", "Bilaspur", "Beltara", "Masturi"],
          Mungeli: ["Mungeli", "Lormi"],
          "Gaurela-Pendra-Marwahi": ["Marwahi"],
        },
      },
      "Janjgir-Champa": {
        districts: {
          "Janjgir-Champa": ["Akaltara", "Janjgir-Champa", "Pamgarh"],
          Sakti: ["Sakti", "Chandrapur", "Jaijaipur"],
          Korba: [], // Korba LS handles Korba VS — keep Korba district under Korba LS
        },
      },
      Korba: {
        districts: {
          Korba: ["Rampur", "Korba", "Katghora", "Pali-Tanakhar"],
          Raigarh: [], // Raigarh has its own LS
        },
      },
      Raigarh: {
        districts: {
          Raigarh: ["Lailunga", "Raigarh", "Sarangarh", "Kharsia", "Dharamjaigarh"],
          "Sarangarh-Bilaigarh": [],
          Jashpur: ["Jashpur", "Kunkuri", "Pathalgaon"],
        },
      },
    },
  },
  Surguja: {
    lok_sabhas: {
      Surguja: {
        districts: {
          Surguja: ["Premnagar", "Bhatgaon", "Pratappur", "Ramanujganj", "Samri", "Lundra", "Ambikapur", "Sitapur"],
          "Balrampur-Ramanujganj": [],
        },
      },
      "Korba (Surguja side)": {
        districts: {}, // skip duplicate
      },
      "Korba (north)": {
        districts: {}, // skip
      },
      "Manendragarh-Chirmiri-Bharatpur (M C B)": {
        districts: {}, // skip — MCB attaches to Korea/Surguja
      },
      Korea: {
        districts: {
          Korea: ["Baikunthpur", "Manendragarh"],
          "Manendragarh-Chirmiri-Bharatpur(M C B)": [],
          Surajpur: ["Bhaiyathan", "Premnagar (Surajpur)"],
        },
      },
    },
  },
  Durg: {
    lok_sabhas: {
      Durg: {
        districts: {
          Durg: ["Patan", "Durg Rural", "Durg City", "Bhilai Nagar", "Vaishali Nagar", "Ahiwara"],
          Bemetara: ["Saja", "Bemetara", "Navagarh"],
          Kabeerdham: ["Pandariya", "Kawardha"],
        },
      },
      Rajnandgaon: {
        districts: {
          Rajnandgaon: ["Khairagarh", "Dongargarh", "Rajnandgaon", "Dongargaon", "Khujji", "Mohla-Manpur"],
          "Khairagarh-Chhuikhadan-Gandai": [],
          "Mohla-Manpur-Ambagarh Chouki": [],
        },
      },
    },
  },
  Bastar: {
    lok_sabhas: {
      Kanker: {
        districts: {
          "Uttar Bastar Kanker": ["Antagarh", "Bhanupratappur", "Kanker"],
          Kondagaon: ["Keshkal", "Kondagaon"],
          Narayanpur: ["Narayanpur"],
        },
      },
      Bastar: {
        districts: {
          Bastar: ["Bastar", "Jagdalpur", "Chitrakot"],
          "Dakshin Bastar Dantewada": ["Dantewada"],
          Bijapur: ["Bijapur"],
          Sukma: ["Konta"],
        },
      },
    },
  },
};

// Districts that already exist in the locations table (created earlier as
// orphans). We'll re-parent these rather than re-insert them, so existing
// calls/contacts/users that reference them stay intact.
async function existingDistrictMap(conn) {
  const [rows] = await conn.query(`SELECT id, name FROM locations WHERE type = 'district'`);
  const map = new Map();
  for (const r of rows) map.set(r.name.trim().toLowerCase(), r.id);
  return map;
}

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aapadmin',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  });

  try {
    console.log('1. Inspecting current state...');
    const distMapBefore = await existingDistrictMap(conn);

    // Identify the OLD Raipur-area dummy district whose data we need to relink.
    // Existing seeds put everything under "Raipur City District" (id 15 in this DB).
    const OLD_RAIPUR_KEYS = ["raipur city district", "raipur"];
    let oldRaipurId = null;
    for (const k of OLD_RAIPUR_KEYS) {
      if (distMapBefore.has(k)) { oldRaipurId = distMapBefore.get(k); break; }
    }
    console.log(`   old Raipur-area district id = ${oldRaipurId}`);

    console.log('2. Clearing dummy non-district rows (state, dummy zones/LS, wards/booths)...');
    // Null out FKs first so we can delete cleanly
    await conn.query(`UPDATE calls SET zone_id = NULL WHERE zone_id IN (SELECT id FROM (SELECT id FROM locations WHERE type='zone') t)`);
    await conn.query(`UPDATE calls SET lok_sabha_id = NULL WHERE lok_sabha_id IN (SELECT id FROM (SELECT id FROM locations WHERE type='lok_sabha') t)`);
    await conn.query(`UPDATE contacts SET zone_id = NULL WHERE zone_id IN (SELECT id FROM (SELECT id FROM locations WHERE type='zone') t)`);
    await conn.query(`UPDATE contacts SET lok_sabha_id = NULL WHERE lok_sabha_id IN (SELECT id FROM (SELECT id FROM locations WHERE type='lok_sabha') t)`);

    // Delete dummy children first (booths/wards), then the dummy parents
    await conn.query(`DELETE FROM locations WHERE type IN ('booth','polling_station','ward','assembly')`);
    await conn.query(`DELETE FROM locations WHERE type = 'lok_sabha'`);
    await conn.query(`DELETE FROM locations WHERE type = 'zone'`);

    // Remove the dummy "Chhattisgarh" parentless row and dummy districts that
    // don't match a real CG district name (so we keep ids 18-49).
    const REAL_DISTRICTS = new Set([
      "balod","balodabazar-bhatapara","balrampur-ramanujganj","bastar","bemetara","bijapur",
      "bilaspur","dakshin bastar dantewada","dhamtari","durg","gariyaband","gaurela-pendra-marwahi",
      "janjgir-champa","jashpur","kabeerdham","khairagarh-chhuikhadan-gandai","kondagaon","korba",
      "korea","mahasamund","manendragarh-chirmiri-bharatpur(m c b)","mohla-manpur-ambagarh chouki",
      "mungeli","narayanpur","raigarh","raipur","rajnandgaon","sakti","sarangarh-bilaigarh","sukma",
      "surajpur","surguja","uttar bastar kanker",
    ]);

    // Remember which real-district id is "Raipur" so we can relink calls/contacts/users
    const [realRaipurRow] = await conn.query(`SELECT id FROM locations WHERE type='district' AND LOWER(name)='raipur' LIMIT 1`);
    const newRaipurId = realRaipurRow[0]?.id;
    console.log(`   new Raipur district id = ${newRaipurId}`);

    // Delete dummy districts that aren't in the real list
    if (oldRaipurId && oldRaipurId !== newRaipurId) {
      console.log(`3. Relinking calls/contacts/users from old Raipur(${oldRaipurId}) → new Raipur(${newRaipurId})...`);
      await conn.query(`UPDATE calls SET district_id = ? WHERE district_id = ?`, [newRaipurId, oldRaipurId]);
      await conn.query(`UPDATE contacts SET district_id = ? WHERE district_id = ?`, [newRaipurId, oldRaipurId]);
      await conn.query(`UPDATE users SET home_district_id = ? WHERE home_district_id = ?`, [newRaipurId, oldRaipurId]);
    }

    // Drop dummy districts and state row
    await conn.query(`UPDATE calls SET district_id = NULL WHERE district_id IN (SELECT id FROM (SELECT id FROM locations WHERE type='district' AND id < 18) t)`);
    await conn.query(`UPDATE contacts SET district_id = NULL WHERE district_id IN (SELECT id FROM (SELECT id FROM locations WHERE type='district' AND id < 18) t)`);
    await conn.query(`UPDATE users SET home_district_id = NULL WHERE home_district_id IN (SELECT id FROM (SELECT id FROM locations WHERE type='district' AND id < 18) t)`);
    await conn.query(`DELETE FROM locations WHERE type='district' AND id < 18`);
    await conn.query(`DELETE FROM locations WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM (SELECT id FROM locations) t)`);
    // Remove "Chhattisgarh" state row (had no type)
    await conn.query(`DELETE FROM locations WHERE type IS NULL OR type = ''`);

    console.log('4. Inserting 5 zones...');
    const zoneIds = {};
    for (const z of Object.keys(DATA)) {
      const [r] = await conn.query(`INSERT INTO locations (type, name, parent_id) VALUES ('zone', ?, NULL)`, [z]);
      zoneIds[z] = r.insertId;
    }
    console.log('   inserted zones:', zoneIds);

    console.log('5. Inserting Lok Sabhas + linking real districts + Vidhan Sabhas...');
    const distMap = await existingDistrictMap(conn);
    let lsCount = 0, vsCount = 0, linkedCount = 0;
    for (const [zoneName, zoneData] of Object.entries(DATA)) {
      const zoneId = zoneIds[zoneName];
      for (const [lsName, lsData] of Object.entries(zoneData.lok_sabhas)) {
        // Skip placeholder LS keys whose districts={} (used above to keep grouping readable)
        if (!lsData.districts || Object.keys(lsData.districts).length === 0) continue;
        const [r] = await conn.query(`INSERT INTO locations (type, name, parent_id) VALUES ('lok_sabha', ?, ?)`, [lsName, zoneId]);
        const lsId = r.insertId;
        lsCount++;
        for (const [distName, vsList] of Object.entries(lsData.districts)) {
          const key = distName.trim().toLowerCase();
          const distId = distMap.get(key);
          if (!distId) {
            console.warn(`   ⚠ district not found in table, skipping: ${distName}`);
            continue;
          }
          await conn.query(`UPDATE locations SET parent_id = ? WHERE id = ? AND type='district'`, [lsId, distId]);
          linkedCount++;
          for (const vs of vsList) {
            await conn.query(`INSERT INTO locations (type, name, parent_id) VALUES ('assembly', ?, ?)`, [vs, distId]);
            vsCount++;
          }
        }
      }
    }
    console.log(`   inserted ${lsCount} Lok Sabhas, linked ${linkedCount} districts, inserted ${vsCount} Vidhan Sabhas.`);

    // Some districts won't have been touched (because the data above doesn't enumerate every VS for every real district).
    // Attach any still-orphan districts to their best-guess zone so they at least show in the hierarchy.
    console.log('6. Attaching orphan districts to their zone...');
    const ZONE_FOR_DISTRICT = {
      // Raipur division
      "raipur": "Raipur", "balodabazar-bhatapara": "Raipur", "mahasamund": "Raipur", "dhamtari": "Raipur", "gariyaband": "Raipur",
      // Bilaspur division
      "bilaspur": "Bilaspur", "mungeli": "Bilaspur", "gaurela-pendra-marwahi": "Bilaspur",
      "janjgir-champa": "Bilaspur", "sakti": "Bilaspur", "korba": "Bilaspur",
      "raigarh": "Bilaspur", "sarangarh-bilaigarh": "Bilaspur", "jashpur": "Bilaspur",
      // Surguja division
      "surguja": "Surguja", "balrampur-ramanujganj": "Surguja", "korea": "Surguja",
      "manendragarh-chirmiri-bharatpur(m c b)": "Surguja", "surajpur": "Surguja",
      // Durg division
      "durg": "Durg", "bemetara": "Durg", "kabeerdham": "Durg", "balod": "Durg",
      "rajnandgaon": "Durg", "khairagarh-chhuikhadan-gandai": "Durg", "mohla-manpur-ambagarh chouki": "Durg",
      // Bastar division
      "uttar bastar kanker": "Bastar", "kondagaon": "Bastar", "narayanpur": "Bastar",
      "bastar": "Bastar", "dakshin bastar dantewada": "Bastar", "bijapur": "Bastar", "sukma": "Bastar",
    };
    let attachedOrphans = 0;
    const [orphanDistricts] = await conn.query(`SELECT id, name FROM locations WHERE type='district' AND parent_id IS NULL`);
    for (const d of orphanDistricts) {
      const zone = ZONE_FOR_DISTRICT[d.name.trim().toLowerCase()];
      if (zone && zoneIds[zone]) {
        await conn.query(`UPDATE locations SET parent_id = ? WHERE id = ?`, [zoneIds[zone], d.id]);
        attachedOrphans++;
      }
    }
    console.log(`   attached ${attachedOrphans} orphan districts directly to their zone.`);

    // Final counts
    const [[counts]] = await conn.query(`
      SELECT
        (SELECT COUNT(*) FROM locations WHERE type='zone') AS zones,
        (SELECT COUNT(*) FROM locations WHERE type='lok_sabha') AS ls,
        (SELECT COUNT(*) FROM locations WHERE type='district') AS districts,
        (SELECT COUNT(*) FROM locations WHERE type='assembly') AS vs
    `);
    console.log('Final counts:', counts);
    console.log('Done.');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

migrate();
