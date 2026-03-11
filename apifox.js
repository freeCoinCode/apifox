/**
 * Cloudflare Worker: HTTP Client Tool (Advanced)
 * 功能：
 * 1. 动态 Key-Value 配置
 * 2. IP 地址展示 (Client & Server)
 * 3. 智能 JSON Body 检测与 Header 自动补全
 * 4. 实时时钟
 * 5. 免责声明
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 根路径：返回 HTML 界面
    if (url.pathname === "/") {
      const clientIp = request.headers.get("CF-Connecting-IP") || 
                       request.headers.get("X-Forwarded-For") || 
                       "Unknown";
      
      return new Response(getHtmlContent(clientIp), {
        headers: { "Content-Type": "text/html;charset=UTF-8" },
      });
    }

    // 2. /proxy 路径：处理请求转发
    if (url.pathname === "/proxy" && request.method === "POST") {
      try {
        const data = await request.json();
        const { method, url: targetUrl, headersList, paramsList, body, autoJson, checkExitIp } = data;

        let exitIp = "N/A";

        // 检查出口 IP
        if (checkExitIp || targetUrl === "__CHECK_EXIT_IP__") {
          try {
            const ipRes = await fetch("https://api.ipify.org?format=json");
            if (ipRes.ok) {
              const ipData = await ipRes.json();
              exitIp = ipData.ip;
            }
          } catch (e) {
            exitIp = "Failed to detect";
          }
          if (targetUrl === "__CHECK_EXIT_IP__") {
            return jsonResponse({ exitIp: exitIp });
          }
        }

        // --- 构建 URL ---
        let finalUrl = targetUrl;
        try {
          const urlObj = new URL(targetUrl);
          if (paramsList && Array.isArray(paramsList)) {
            paramsList.forEach(item => {
              if (item.key && item.key.trim() !== "") {
                urlObj.searchParams.append(item.key, item.value || "");
              }
            });
          }
          finalUrl = urlObj.toString();
        } catch (e) {
          return jsonResponse({ error: "Invalid Target URL format", exitIp }, 400);
        }

        // --- 构建 Headers (含智能 JSON 处理) ---
        const requestHeaders = new Headers();
        let hasContentType = false;

        if (headersList && Array.isArray(headersList)) {
          headersList.forEach(item => {
            if (item.key && item.key.trim() !== "") {
              // 检查是否手动设置了 Content-Type
              if (item.key.toLowerCase() === 'content-type') {
                hasContentType = true;
              }
              requestHeaders.append(item.key, item.value || "");
            }
          });
        }

        // 智能 Body 处理
        let requestBody = null;
        const upperMethod = method.toUpperCase();
        
        if (!["GET", "HEAD"].includes(upperMethod) && body && body.trim() !== "") {
          requestBody = body;
          
          // 如果开启了自动 JSON 检测，且用户没有手动设置 Content-Type
          if (autoJson && !hasContentType) {
            try {
              // 尝试解析 JSON 以验证格式
              JSON.parse(body);
              // 如果是合法 JSON，自动添加 Header
              requestHeaders.set("Content-Type", "application/json");
            } catch (e) {
              // 不是合法 JSON，保持原样 (可能是 form-data 或 raw text)，不添加 JSON header
            }
          }
        }

        const fetchOptions = {
          method: upperMethod,
          headers: requestHeaders,
          body: requestBody,
        };

        const startTime = Date.now();
        const response = await fetch(finalUrl, fetchOptions);
        const duration = Date.now() - startTime;
        
        const responseText = await response.text();
        let responseData;
        try {
          responseData = JSON.parse(responseText);
        } catch (e) {
          responseData = responseText;
        }

        return jsonResponse({
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          data: responseData,
          raw: responseText,
          duration: duration,
          exitIp: exitIp
        });

      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 3. 专门用于检测出口 IP
    if (url.pathname === "/check-ip" && request.method === "GET") {
       try {
          const ipRes = await fetch("https://api.ipify.org?format=json");
          const ipData = await ipRes.json();
          return jsonResponse({ exitIp: ipData.ip });
       } catch (e) {
          return jsonResponse({ error: e.message, exitIp: "Unknown" }, 500);
       }
    }

    return new Response("Not Found", { status: 404 });
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: { "Content-Type": "application/json" },
  });
}

function getHtmlContent(initialClientIp) {
  // 获取当前服务器时间用于初始渲染，后续由前端 JS 接管
  const now = new Date();
  const initialTime = now.toLocaleString('zh-CN', { hour12: false });

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title> HTTP Client Pro</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #f8f9fa; display: flex; flex-direction: column; min-height: 100vh; }
        .result-box { background: #fff; border: 1px solid #dee2e6; border-radius: 5px; padding: 15px; min-height: 200px; white-space: pre-wrap; font-family: monospace; font-size: 0.9em; max-height: 500px; overflow-y: auto; }
        .kv-row { display: flex; gap: 10px; margin-bottom: 8px; align-items: center; }
        .kv-row input { flex: 1; }
        .btn-remove { width: 40px; }
        .loading-spinner { display: none; }
        .ip-badge { font-size: 0.9rem; font-weight: normal; }
        .ip-section { background: #e9ecef; padding: 10px; border-radius: 8px; margin-bottom: 20px; }
        .clock-section { text-align: right; font-family: monospace; font-size: 1.1rem; color: #0d6efd; font-weight: bold; }
        .footer-disclaimer { margin-top: auto; background: #343a40; color: #adb5bd; padding: 20px 0; text-align: center; font-size: 0.85rem; }
        .json-hint { font-size: 0.8rem; color: #6c757d; }
    </style>
</head>
<body>

<div class="container py-4 flex-grow-1">
    <div class="d-flex justify-content-between align-items-center mb-4">
        <h1 class="mb-0">☁️ HTTP Client Pro</h1>
        <div class="clock-section">
            🕒 <span id="realTimeClock">${initialTime}</span>
        </div>
    </div>
    
    <!-- IP Information -->
    <div class="ip-section row g-3 align-items-center">
        <div class="col-md-6">
            <span class="fw-bold">🖥️ 客户端 IP:</span>
            <span class="badge bg-primary ms-2" id="clientIpDisplay">${initialClientIp}</span>
        </div>
        <div class="col-md-6">
            <span class="fw-bold">🌐 服务端出口 IP:</span>
            <span class="badge bg-success ms-2" id="serverIpDisplay">加载中...</span>
            <span class="text-primary small ms-2" style="cursor:pointer; text-decoration:underline;" onclick="fetchServerIp()">[刷新]</span>
        </div>
    </div>

    <div class="card shadow-sm">
        <div class="card-body">
            <form id="httpForm">
                <!-- URL and Method -->
                <div class="row mb-3">
                    <div class="col-md-2">
                        <select class="form-select" id="method">
                            <option value="GET" selected>GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="DELETE">DELETE</option>
                            <option value="PATCH">PATCH</option>
                            <option value="HEAD">HEAD</option>
                        </select>
                    </div>
                    <div class="col-md-10">
                        <input type="url" class="form-control" id="url" placeholder="https://api.example.com/data" required value="https://httpbin.org/post">
                    </div>
                </div>

                <!-- Tabs -->
                <ul class="nav nav-tabs mb-3" id="myTab" role="tablist">
                    <li class="nav-item" role="presentation">
                        <button class="nav-link active" id="params-tab" data-bs-toggle="tab" data-bs-target="#params-pane" type="button">Query Params</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="headers-tab" data-bs-toggle="tab" data-bs-target="#headers-pane" type="button">Headers</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="body-tab" data-bs-toggle="tab" data-bs-target="#body-pane" type="button">Body</button>
                    </li>
                </ul>

                <div class="tab-content mb-3" id="myTabContent">
                    <!-- Params -->
                    <div class="tab-pane fade show active" id="params-pane">
                        <div id="params-container"></div>
                        <button type="button" class="btn btn-sm btn-outline-secondary mt-2" onclick="addRow('params-container')">+ 添加参数</button>
                    </div>
                    <!-- Headers -->
                    <div class="tab-pane fade" id="headers-pane">
                        <div id="headers-container"></div>
                        <button type="button" class="btn btn-sm btn-outline-secondary mt-2" onclick="addRow('headers-container')">+ 添加 Header</button>
                    </div>
                    <!-- Body -->
                    <div class="tab-pane fade" id="body-pane">
                        <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="autoJsonCheck" checked>
                            <label class="form-check-label" for="autoJsonCheck">
                                智能检测 JSON (自动添加 Content-Type: application/json)
                            </label>
                        </div>
                        <textarea class="form-control" id="body" rows="8" placeholder='{ "key": "value" }'></textarea>
                        <div class="json-hint mt-1">如果勾选上方选项且内容为合法 JSON，系统将自动设置 Header。</div>
                    </div>
                </div>

                <div class="d-grid gap-2">
                    <button type="submit" class="btn btn-primary btn-lg">
                        <span class="spinner-border spinner-border-sm loading-spinner" role="status" aria-hidden="true"></span>
                        <span class="btn-text">发送请求</span>
                    </button>
                </div>
            </form>
        </div>
    </div>

    <!-- Response -->
    <div class="mt-4">
        <h4>Response <small class="text-muted" id="durationDisplay"></small></h4>
        <div id="statusBadge" class="mb-2"></div>
        <div class="result-box" id="responseOutput">等待请求...</div>
    </div>
</div>

<!-- Footer Disclaimer -->
<footer class="footer-disclaimer">
    <div class="container">
        <p class="mb-0">
            <strong>⚠️ 免责声明：</strong> 本工具仅供技术交流、学习及合法的 API 调试使用。
            <br>
            请勿利用本工具进行任何非法攻击、扫描、滥用或违反法律法规的行为。使用者需对自己的行为承担全部法律责任。
        </p>
    </div>
</footer>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script>
    // 1. 实时时钟逻辑
    function updateClock() {
        const now = new Date();
        const timeString = now.toLocaleString('zh-CN', { hour12: false });
        document.getElementById('realTimeClock').textContent = timeString;
    }
    setInterval(updateClock, 1000); // 每秒更新

    // 2. 初始化
    document.addEventListener('DOMContentLoaded', () => {
        addRow('params-container');
        addRow('headers-container');
        fetchServerIp();
        
        document.getElementById('method').addEventListener('change', function(e) {
            const method = e.target.value.toUpperCase();
            const bodyTab = document.getElementById('body-tab');
            const bodyPane = document.getElementById('body');
            if (['GET', 'HEAD'].includes(method)) {
                bodyTab.classList.add('disabled');
                bodyPane.disabled = true;
                bodyPane.placeholder = "GET/HEAD 请求不需要 Body";
            } else {
                bodyTab.classList.remove('disabled');
                bodyPane.disabled = false;
                bodyPane.placeholder = '{ "key": "value" }';
            }
        });
    });

    async function fetchServerIp() {
        const display = document.getElementById('serverIpDisplay');
        display.textContent = "查询中...";
        try {
            const res = await fetch('/check-ip');
            const data = await res.json();
            display.textContent = data.exitIp || "获取失败";
        } catch (e) {
            display.textContent = "错误";
        }
    }

    function addRow(containerId) {
        const container = document.getElementById(containerId);
        const rowId = 'row-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        const div = document.createElement('div');
        div.className = 'kv-row';
        div.id = rowId;
        div.innerHTML = \`
            <input type="text" class="form-control form-control-sm" placeholder="Key" name="key">
            <input type="text" class="form-control form-control-sm" placeholder="Value" name="value">
            <button type="button" class="btn btn-outline-danger btn-sm btn-remove" onclick="removeRow('\${rowId}')">&times;</button>
        \`;
        container.appendChild(div);
    }

    function removeRow(rowId) {
        const row = document.getElementById(rowId);
        if (row) row.remove();
    }

    function collectData(containerId) {
        const container = document.getElementById(containerId);
        const rows = container.querySelectorAll('.kv-row');
        const result = [];
        rows.forEach(row => {
            const keyInput = row.querySelector('input[name="key"]');
            const valInput = row.querySelector('input[name="value"]');
            const key = keyInput.value.trim();
            const value = valInput.value;
            if (key) {
                result.push({ key: key, value: value });
            }
        });
        return result;
    }

    document.getElementById('httpForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const btnText = document.querySelector('.btn-text');
        const spinner = document.querySelector('.loading-spinner');
        const output = document.getElementById('responseOutput');
        const statusBadge = document.getElementById('statusBadge');
        const durationDisplay = document.getElementById('durationDisplay');
        const serverIpDisplay = document.getElementById('serverIpDisplay');

        btnText.textContent = "请求中...";
        spinner.style.display = "inline-block";
        output.textContent = "Loading...";
        statusBadge.innerHTML = "";
        durationDisplay.textContent = "";

        const payload = {
            method: document.getElementById('method').value,
            url: document.getElementById('url').value,
            headersList: collectData('headers-container'),
            paramsList: collectData('params-container'),
            body: document.getElementById('body').value,
            autoJson: document.getElementById('autoJsonCheck').checked, // 获取复选框状态
            checkExitIp: true
        };

        try {
            const res = await fetch('/proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await res.json();

            if (result.exitIp && result.exitIp !== "N/A") {
                serverIpDisplay.textContent = result.exitIp;
            }

            if (result.error) {
                output.textContent = "Error: " + result.error;
                statusBadge.innerHTML = '<span class="badge bg-danger">Request Failed</span>';
            } else {
                const statusColor = result.status >= 200 && result.status < 300 ? 'bg-success' : 'bg-warning';
                statusBadge.innerHTML = \`<span class="badge \${statusColor}">\${result.status} \${result.statusText}</span>\`;
                
                if (result.duration) {
                    durationDisplay.textContent = \`(\${result.duration}ms)\`;
                }

                if (typeof result.data === 'object') {
                    output.textContent = JSON.stringify(result.data, null, 2);
                } else {
                    output.textContent = result.raw || result.data;
                }
            }
        } catch (err) {
            output.textContent = "Network Error: " + err.message;
            statusBadge.innerHTML = '<span class="badge bg-danger">Network Error</span>';
        } finally {
            btnText.textContent = "发送请求";
            spinner.style.display = "none";
        }
    });
</script>
</body>
</html>
  `;
}
