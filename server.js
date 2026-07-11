import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 5173);
const maxBodyBytes = 1_000_000;
const upstreamTimeoutMs = 20_000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const securityHeaders = {
  "content-security-policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), geolocation=(), microphone=()"
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    let byteLength = 0;
    let settled = false;

    req.on("data", chunk => {
      if (settled) return;
      byteLength += chunk.length;
      if (byteLength > maxBodyBytes) {
        settled = true;
        const error = new Error("Request body is too large.");
        error.statusCode = 413;
        rejectBody(error);
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!settled) resolveBody(body);
    });
    req.on("error", error => {
      if (!settled) rejectBody(error);
    });
  });
}

async function handleAdvice(req, res) {
  let timeout;
  try {
    const raw = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(raw || "{}");
    } catch {
      sendJson(res, 400, { error: "Request body must be valid JSON." });
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      sendJson(res, 501, { error: "OPENAI_API_KEY is not configured." });
      return;
    }

    const model = process.env.OPENAI_MODEL || "gpt-5-mini";
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "你是一个谨慎的个人习惯和健身记录分析助手。你可以根据用户记录给出训练、恢复和习惯建议，但不能做医疗诊断。若看到疼痛或异常疲劳，应建议降低强度并在必要时咨询专业人士。输出中文，简洁、具体、可执行。"
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `请基于以下记录生成建议。请分为：最近总结、训练建议、恢复建议、风险提醒、下一步行动。\n\n${JSON.stringify(payload, null, 2)}`
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      sendJson(res, response.status, { error: data.error?.message || "OpenAI request failed." });
      return;
    }

    const text = data.output_text
      || data.output?.flatMap(item => item.content || []).map(part => part.text || "").join("\n").trim();
    sendJson(res, 200, { advice: text || "模型没有返回可读建议。", model });
  } catch (error) {
    if (error.name === "AbortError") {
      sendJson(res, 504, { error: "AI service timed out." });
      return;
    }
    sendJson(res, error.statusCode || 500, {
      error: error.statusCode ? error.message : "Unable to generate advice."
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function handleStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let requestedPath;
  try {
    requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  const filePath = resolve(publicDir, `.${requestedPath}`);
  const relativePath = relative(publicDir, filePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    const extension = extname(filePath);
    const hasVersion = url.searchParams.has("v");
    const cacheControl = extension === ".html" || extension === ".webmanifest" || relativePath === "sw.js"
      ? "no-cache"
      : hasVersion ? "public, max-age=31536000, immutable" : "public, max-age=3600";
    res.writeHead(200, {
      "content-type": mimeTypes[extension] || "application/octet-stream",
      "cache-control": cacheControl
    });
    res.end(req.method === "HEAD" ? undefined : file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  Object.entries(securityHeaders).forEach(([name, value]) => res.setHeader(name, value));
  const pathname = new URL(req.url, "http://localhost").pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_MODEL || "gpt-5-mini"
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/advice") {
    await handleAdvice(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    await handleStatic(req, res);
    return;
  }

  res.writeHead(405, {
    "content-type": "text/plain; charset=utf-8",
    allow: "GET, HEAD"
  });
  res.end("Method not allowed");
});

server.listen(port, () => {
  console.log(`Habit fitness app running at http://localhost:${port}`);
});
