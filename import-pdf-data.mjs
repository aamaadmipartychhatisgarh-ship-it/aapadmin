import fs from 'fs';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function importData() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'aapadmin',
        port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    });

    try {
        const text = fs.readFileSync('pdf_output.txt', 'utf-8');
        const lines = text.split('\n');

        let currentDesignation = 'Unassigned';
        let namesBuffer = [];
        let parsedData = [];

        for (let line of lines) {
            line = line.trim();
            // Skip empty lines and headers/footers
            if (!line || 
                line.includes('Page') && line.includes('Break') || 
                line.includes('POSTHOLDERS') || 
                line.includes('AAM AADMI PARTY') ||
                line.includes('STATE • LOKSABHA') ||
                line.includes('Number of Block') ||
                line === 'ASAP' || 
                line === 'KEY') {
                continue;
            }

            const match = line.match(/^(\d+)\.\s*(.+)$/);
            if (match) {
                namesBuffer.push(match[2].trim());
            } else {
                let desig = line;
                if (namesBuffer.length > 0) {
                    namesBuffer.forEach(n => parsedData.push({ rawName: n, designation: desig }));
                    namesBuffer = [];
                    currentDesignation = desig;
                } else {
                    currentDesignation = desig;
                }
            }
        }
        
        if (namesBuffer.length > 0) {
            namesBuffer.forEach(n => parsedData.push({ rawName: n, designation: currentDesignation }));
        }

        console.log(`Parsed ${parsedData.length} records. Extracting designations...`);

        // Get unique designations
        const uniqueDesignations = [...new Set(parsedData.map(d => d.designation))];
        
        // Insert missing designations
        for (const desig of uniqueDesignations) {
            await connection.query('INSERT IGNORE INTO designations (name) VALUES (?)', [desig]);
        }

        // Map designation names to IDs
        const [desigRows] = await connection.query('SELECT id, name FROM designations');
        const desigMap = {};
        for (const row of desigRows) {
            desigMap[row.name] = row.id;
        }

        // Get admin user ID
        const [adminRows] = await connection.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
        const adminId = adminRows.length > 0 ? adminRows[0].id : 1;

        console.log('Inserting into calls table...');
        
        let inserted = 0;
        for (const item of parsedData) {
            // Extract location if present in parentheses e.g. "Name (Location)"
            let personName = item.rawName;
            let location = '';
            const locMatch = personName.match(/^(.*?)(?:\s*\((.*?)\))?$/);
            if (locMatch) {
                personName = locMatch[1].trim();
                location = locMatch[2] ? locMatch[2].trim() : '';
            }
            
            // Remove " Ji" from end if present to clean it up slightly, optional but good practice
            if (personName.endsWith(' Ji')) {
                personName = personName.slice(0, -3).trim();
            }

            const desigId = desigMap[item.designation];

            await connection.query(
                `INSERT INTO calls (person_name, phone_number, status_id, user_id, designation_id, remarks) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [personName, '000000', 1, adminId, desigId, location || null]
            );
            inserted++;
        }

        console.log(`Successfully imported ${inserted} postholders into the database with phone number '000000'!`);
        
    } catch (err) {
        console.error('Error importing data:', err);
    } finally {
        await connection.end();
    }
}

importData();