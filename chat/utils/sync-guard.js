const fs = require('fs');
const path = require('path');

/**
 * SyncGuard - Manages process-level locking for background sync tasks.
 * Ensures only one instance of a specific sync type (e.g., 'whatsapp', 'kyc') 
 * is running at any given time.
 */
class SyncGuard {
    constructor() {
        this.lockDir = path.join(__dirname, '../data/locks');
        if (!fs.existsSync(this.lockDir)) {
            fs.mkdirSync(this.lockDir, { recursive: true });
        }
    }

    _getLockPath(source) {
        return path.join(this.lockDir, `${source}.lock`);
    }

    /**
     * Checks if a specific source is currently locked.
     * Also handles "stale" locks by checking if the pid in the lockfile exists.
     */
    isLocked(source) {
        const lockPath = this._getLockPath(source);
        if (!fs.existsSync(lockPath)) return false;

        try {
            const pid = parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
            if (isNaN(pid)) return false;

            // Check if process still exists
            try {
                process.kill(pid, 0);
                return true;
            } catch (e) {
                // Process doesn't exist, lock is stale
                console.warn(`[SyncGuard] Found stale lock for ${source} (PID ${pid}). Cleaning up.`);
                this.releaseLock(source);
                return false;
            }
        } catch (e) {
            return false;
        }
    }

    /**
     * Attempts to acquire a lock for a source.
     * @returns {boolean} True if lock acquired, false if already locked.
     */
    acquireLock(source) {
        if (this.isLocked(source)) return false;

        const lockPath = this._getLockPath(source);
        try {
            fs.writeFileSync(lockPath, process.pid.toString());
            return true;
        } catch (e) {
            console.error(`[SyncGuard] Failed to acquire lock for ${source}:`, e.message);
            return false;
        }
    }

    /**
     * Releases a lock for a source.
     */
    releaseLock(source) {
        const lockPath = this._getLockPath(source);
        if (fs.existsSync(lockPath)) {
            try {
                fs.unlinkSync(lockPath);
            } catch (e) {
                console.error(`[SyncGuard] Failed to release lock for ${source}:`, e.message);
            }
        }
    }
}

module.exports = new SyncGuard();
