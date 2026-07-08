import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 5173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleAdvice(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    sendJson(res, 501, { error: "OPENAI_API_KEY is not configured." });
    return;
  }

  try {
    const raw = await readBody(req);
    const payload = JSON.parse(raw || "{}");
    const model = process.env.OPENAI_MODEL || "gpt-5-mini";
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
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
                text: "你是一个谨慎的个人习惯和健身记录分析助手。你可以根据用户记录给出训练、恢复和习惯建议，但不能做医疗诊断。若看到疼痛或异常疲劳，应建议降低强度并必要时咨询专业人士。输出中文，简洁、具体、可执行。"
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

    const text = data.output_text || data.output?.flatMap(item => item.content || []).map(part => part.text || "").join("\n").trim();
    sendJson(res, 200, { advice: text || "模型没有返回可读建议。", model });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unknown server error." });
  }
}

async function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(publicDir, requestedPath));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, {
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_MODEL || "gpt-5-mini"
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/advice") {
    await handleAdvice(req, res);
    return;
  }

  if (req.method === "GET") {
    await handleStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(port, () => {
  console.log(`Habit fitness app running at http://localhost:${port}`);
});
