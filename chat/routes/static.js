/**
 * {reply} - Static Asset Routes
 * Handles serving HTML, CSS, JS, and image assets.
 */

const fs = require("fs");
const path = require("path");

const HTML_PATH = path.join(__dirname, "..", "index.html");
const SETTINGS_HTML_PATH = path.join(__dirname, "..", "settings.html");
const HIDDEN_CONTACTS_HTML_PATH = path.join(__dirname, "..", "hidden-contacts.html");
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

/**
 * Serves index.html with operator token injection
 */
function serveIndex(req, res, securityPolicy) {
    fs.readFile(HTML_PATH, "utf8", (err, data) => {
        if (err) {
            res.writeHead(500);
            res.end("Error loading UI");
            return;
        }
        // Inject operator token into window scope
        let content = data;
        if (securityPolicy.operatorToken) {
            const inject = `<script>window.REPLY_OPERATOR_TOKEN = "${securityPolicy.operatorToken}";</script>\n</head>`;
            content = content.replace("</head>", inject);
        }
        res.writeHead(200, {
            "Content-Type": "text/html",
            "Cache-Control": "no-store, no-cache, must-revalidate"
        });
        res.end(content);
    });
}

/**
 * Serves settings.html with operator token injection
 */
function serveSettingsPage(req, res, securityPolicy) {
    fs.readFile(SETTINGS_HTML_PATH, "utf8", (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end("Settings page not found");
            return;
        }
        // Inject operator token into window scope
        let content = data;
        if (securityPolicy.operatorToken) {
            const inject = `<script>window.REPLY_OPERATOR_TOKEN = "${securityPolicy.operatorToken}";</script>\n</head>`;
            content = content.replace("</head>", inject);
        }
        res.writeHead(200, {
            "Content-Type": "text/html",
            "Cache-Control": "no-store, no-cache, must-revalidate"
        });
        res.end(content);
    });
}

function serveHiddenContactsPage(req, res, securityPolicy) {
    fs.readFile(HIDDEN_CONTACTS_HTML_PATH, "utf8", (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end("Hidden contacts page not found");
            return;
        }
        let content = data;
        if (securityPolicy.operatorToken) {
            const inject = `<script>window.REPLY_OPERATOR_TOKEN = "${securityPolicy.operatorToken}";</script>\n</head>`;
            content = content.replace("</head>", inject);
        }
        res.writeHead(200, {
            "Content-Type": "text/html",
            "Cache-Control": "no-store, no-cache, must-revalidate"
        });
        res.end(content);
    });
}

/**
 * Serves CSS, JS, Fragments, and Public assets
 */
async function serveAsset(req, res, pathname) {
    const baseDir = pathname.startsWith('/public/') ? path.join(__dirname, "..", "..") : path.join(__dirname, "..");
    const filePath = path.join(baseDir, pathname);

    try {
        const content = await fs.promises.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = {
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.webp': 'image/webp',
        }[ext] || 'text/plain';

        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-store, no-cache, must-revalidate'
        });
        res.end(content);
    } catch (err) {
        res.writeHead(404);
        res.end('Not found');
    }
}

/**
 * Serves SVG icons from root (backward compatibility)
 */
async function serveRootSvg(req, res, pathname) {
    const filePath = path.join(PUBLIC_DIR, pathname.slice(1));
    try {
        const content = await fs.promises.readFile(filePath);
        res.writeHead(200, {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
        });
        res.end(content);
    } catch (err) {
        res.writeHead(404);
        res.end('Not found');
    }
}

module.exports = {
    serveIndex,
    serveSettingsPage,
    serveHiddenContactsPage,
    serveAsset,
    serveRootSvg
};
