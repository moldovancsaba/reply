const fs = require('fs');
const path = require('path');

// Singleton status manager to prevent race conditions
class StatusManager {
    constructor() {
        this.dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    _read(filename) {
        const filepath = path.join(this.dataDir, filename);
        if (fs.existsSync(filepath)) {
            try {
                return JSON.parse(fs.readFileSync(filepath, 'utf8'));
            } catch (e) {
                console.error(`[StatusManager] Error reading ${filename}:`, e.message);
                return {};
            }
        }
        return {};
    }

    _write(filename, data) {
        const filepath = path.join(this.dataDir, filename);
        const tmppath = `${filepath}.tmp`;
        try {
            // Atomic write: write to temp file then rename
            fs.writeFileSync(tmppath, JSON.stringify(data, null, 2));
            fs.renameSync(tmppath, filepath);
        } catch (e) {
            console.error(`[StatusManager] Error writing ${filename}:`, e.message);
            if (fs.existsSync(tmppath)) {
                try { fs.unlinkSync(tmppath); } catch (u) { }
            }
        }
    }

    update(channel, newStatus) {
        const filename = `${channel}_sync_status.json`;

        // 1. Read existing
        const current = this._read(filename);

        // 2. Merge (no validation - trust the sync scripts)
        const merged = {
            ...current,
            ...newStatus,
            timestamp: new Date().toISOString()
        };

        // 3. Write back
        this._write(filename, merged);
        return merged;
    }

    get(channel) {
        return this._read(`${channel}_sync_status.json`);
    }
}

module.exports = new StatusManager();
