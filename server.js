const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { createServer } = require('http');

// 导入配置
const config = require('./config');

// 从配置中获取常量
const {
  UPSTREAM_URL,
  DEFAULT_KEY,
  UPSTREAM_TOKEN,
  MODEL_NAME,
  PORT,
  DEBUG_MODE,
  THINK_TAGS_MODE,
  X_FE_VERSION,
  BROWSER_UA,
  SEC_CH_UA,
  SEC_CH_UA_MOB,
  SEC_CH_UA_PLAT,
  ORIGIN_BASE,
  ANON_TOKEN_ENABLED,
  UPSTREAM_MODEL_ID
} = config;

// 创建Express应用
const app = express();
const server = createServer(app);

// 中间件
app.use(cors());
app.use(express.json());

// debug日志函数
function debugLog(format, ...args) {
  if (DEBUG_MODE) {
    console.log(`[DEBUG] ${format}`, ...args);
  }
}

// 获取匿名token（每次对话使用不同token，避免共享记忆）
async function getAnonymousToken() {
  try {
    const response = await axios.get(`${ORIGIN_BASE}/api/v1/auths/`, {
      timeout: 10000,
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'X-FE-Version': X_FE_VERSION,
        'sec-ch-ua': SEC_CH_UA,
        'sec-ch-ua-mobile': SEC_CH_UA_MOB,
        'sec-ch-ua-platform': SEC_CH_UA_PLAT,
        'Origin': ORIGIN_BASE,
        'Referer': ORIGIN_BASE + '/'
      }
    });

    if (response.status !== 200) {
      throw new Error(`anon token status=${response.status}`);
    }

    const token = response.data.token;
    if (!token) {
      throw new Error('anon token empty');
    }

    return token;
  } catch (error) {
    debugLog('获取匿名token失败: %o', error);
    throw error;
  }
}

// 设置CORS头部
function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// 处理OPTIONS请求
app.options('*', (req, res) => {
  setCORSHeaders(res);
  res.status(200).end();
});

// 模型列表接口
app.get('/v1/models', async (req, res) => {
  setCORSHeaders(res);
  
  const response = {
    object: 'list',
    data: [
      {
        id: MODEL_NAME,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'z.ai'
      }
    ]
  };

  res.setHeader('Content-Type', 'application/json');
  res.json(response);
});

// 聊天完成接口
app.post('/v1/chat/completions', async (req, res) => {
  setCORSHeaders(res);
  
  debugLog('收到chat completions请求');

  // 验证API Key
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    debugLog('缺少或无效的Authorization头');
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const apiKey = authHeader.substring(7); // 去掉 'Bearer '
  if (apiKey !== DEFAULT_KEY) {
    debugLog('无效的API key: %s', apiKey);
    return res.status(401).json({ error: 'Invalid API key' });
  }

  debugLog('API key验证通过');

  // 解析请求
  const { model, messages, stream = false, temperature, max_tokens } = req.body;

  debugLog('请求解析成功 - 模型: %s, 流式: %v, 消息数: %d', model, stream, messages.length);

  // 生成会话相关ID
  const chatID = `${Date.now()}-${Math.floor(Date.now() / 1000)}`;
  const msgID = `${Date.now()}`;

  // 构造上游请求
  const upstreamReq = {
    stream: true, // 总是使用流式从上游获取
    chat_id: chatID,
    id: msgID,
    model: UPSTREAM_MODEL_ID, // 上游实际模型ID
    messages: messages,
    params: {},
    features: {
      enable_thinking: true
    },
    background_tasks: {
      title_generation: false,
      tags_generation: false
    },
    mcp_servers: [],
    model_item: {
      id: UPSTREAM_MODEL_ID,
      name: MODEL_NAME,
      owned_by: 'openai'
    },
    tool_servers: [],
    variables: {
      '{{USER_NAME}}': 'User',
      '{{USER_LOCATION}}': 'Unknown',
      '{{CURRENT_DATETIME}}': new Date().toISOString()
    }
  };

  // 选择本次对话使用的token
  let authToken = UPSTREAM_TOKEN;
  if (ANON_TOKEN_ENABLED) {
    try {
      const token = await getAnonymousToken();
      authToken = token;
      debugLog('匿名token获取成功: %s...', token.substring(0, 10));
    } catch (error) {
      debugLog('匿名token获取失败，回退固定token: %o', error);
    }
  }

  // 调用上游API
  if (stream) {
    handleStreamResponseWithIDs(res, upstreamReq, chatID, authToken);
  } else {
    handleNonStreamResponseWithIDs(res, upstreamReq, chatID, authToken);
  }
});

// 调用上游API
async function callUpstreamWithHeaders(upstreamReq, refererChatID, authToken) {
  try {
    debugLog('调用上游API: %s', UPSTREAM_URL);
    debugLog('上游请求体: %o', upstreamReq);

    const response = await axios.post(UPSTREAM_URL, upstreamReq, {
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'User-Agent': BROWSER_UA,
        'Authorization': `Bearer ${authToken}`,
        'Accept-Language': 'zh-CN',
        'sec-ch-ua': SEC_CH_UA,
        'sec-ch-ua-mobile': SEC_CH_UA_MOB,
        'sec-ch-ua-platform': SEC_CH_UA_PLAT,
        'X-FE-Version': X_FE_VERSION,
        'Origin': ORIGIN_BASE,
        'Referer': `${ORIGIN_BASE}/c/${refererChatID}`
      },
      responseType: 'stream'
    });

    debugLog('上游响应状态: %d %s', response.status, response.statusText);
    return response;
  } catch (error) {
    debugLog('上游请求失败: %o', error);
    throw error;
  }
}

// 处理流式响应
async function handleStreamResponseWithIDs(res, upstreamReq, chatID, authToken) {
  debugLog('开始处理流式响应 (chat_id=%s)', chatID);

  try {
    const response = await callUpstreamWithHeaders(upstreamReq, chatID, authToken);
    
    if (response.status !== 200) {
      debugLog('上游返回错误状态: %d', response.status);
      return res.status(502).json({ error: 'Upstream error' });
    }

    // 用于策略2：总是展示thinking（配合标签处理）
    const transformThinking = (s) => {
      // 去 <summary>…</summary>
      s = s.replace(/<summary>.*?<\/summary>/gs, '');
      // 清理残留自定义标签，如 </thinking>、<Full> 等
      s = s.replace(/<\/thinking>/g, '');
      s = s.replace(/<Full>/g, '');
      s = s.replace(/<\/Full>/g, '');
      s = s.trim();
      
      switch (THINK_TAGS_MODE) {
        case 'think':
          s = s.replace(/<details[^>]*>/g, '<span>');
          s = s.replace(/<\/details>/g, '</span>');
          break;
        case 'strip':
          s = s.replace(/<details[^>]*>/g, '');
          s = s.replace(/<\/details>/g, '');
          break;
      }
      
      // 处理每行前缀 "> "（包括起始位置）
      s = s.replace(/^> /, '');
      s = s.replace(/\n> /g, '\n');
      return s.trim();
    };

    // 设置SSE头部
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // 发送第一个chunk（role）
    const firstChunk = {
      id: `chatcmpl-${Math.floor(Date.now() / 1000)}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: MODEL_NAME,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant' }
        }
      ]
    };
    
    res.write(`data: ${JSON.stringify(firstChunk)}\n\n`);

    // 读取上游SSE流
    debugLog('开始读取上游SSE流');
    let lineCount = 0;
    let buffer = '';

    response.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留最后一个不完整的行

      for (const line of lines) {
        lineCount++;
        
        if (!line.startsWith('data: ')) {
          continue;
        }

        const dataStr = line.substring(6); // 去掉 'data: '
        if (dataStr === '') {
          continue;
        }

        debugLog('收到SSE数据 (第%d行): %s', lineCount, dataStr);

        try {
          const upstreamData = JSON.parse(dataStr);

          // 错误检测（data.error 或 data.data.error 或 顶层error）
          if (upstreamData.error || 
              (upstreamData.data && upstreamData.data.error) || 
              (upstreamData.data && upstreamData.data.inner && upstreamData.data.inner.error)) {
            let errObj = upstreamData.error;
            if (!errObj && upstreamData.data) {
              errObj = upstreamData.data.error;
            }
            if (!errObj && upstreamData.data && upstreamData.data.inner) {
              errObj = upstreamData.data.inner.error;
            }
            
            debugLog('上游错误: code=%d, detail=%s', errObj.code, errObj.detail);
            
            // 结束下游流
            const endChunk = {
              id: `chatcmpl-${Math.floor(Date.now() / 1000)}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: MODEL_NAME,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: 'stop'
                }
              ]
            };
            
            res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
            res.write('data: [DONE]\n\n');
            return;
          }

          debugLog('解析成功 - 类型: %s, 阶段: %s, 内容长度: %d, 完成: %v',
            upstreamData.type, upstreamData.data?.phase, upstreamData.data?.delta_content?.length || 0, upstreamData.data?.done);

          // 策略2：总是展示thinking + answer
          if (upstreamData.data && upstreamData.data.delta_content) {
            let out = upstreamData.data.delta_content;
            
            if (upstreamData.data.phase === 'thinking') {
              out = transformThinking(out);
              // 思考内容使用 reasoning_content 字段
              if (out) {
                debugLog('发送思考内容: %s', out);
                const chunk = {
                  id: `chatcmpl-${Math.floor(Date.now() / 1000)}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: MODEL_NAME,
                  choices: [
                    {
                      index: 0,
                      delta: { reasoning_content: out }
                    }
                  ]
                };
                
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              }
            } else {
              // 普通内容使用 content 字段
              if (out) {
                debugLog('发送普通内容: %s', out);
                const chunk = {
                  id: `chatcmpl-${Math.floor(Date.now() / 1000)}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: MODEL_NAME,
                  choices: [
                    {
                      index: 0,
                      delta: { content: out }
                    }
                  ]
                };
                
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              }
            }
          }

          // 检查是否结束
          if (upstreamData.data && (upstreamData.data.done || upstreamData.data.phase === 'done')) {
            debugLog('检测到流结束信号');
            
            // 发送结束chunk
            const endChunk = {
              id: `chatcmpl-${Math.floor(Date.now() / 1000)}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: MODEL_NAME,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: 'stop'
                }
              ]
            };
            
            res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
            
            // 发送[DONE]
            res.write('data: [DONE]\n\n');
            debugLog('流式响应完成，共处理%d行', lineCount);
            return;
          }
        } catch (error) {
          debugLog('SSE数据解析失败: %o', error);
        }
      }
    });

    response.data.on('end', () => {
      debugLog('上游流结束');
      res.end();
    });

    response.data.on('error', (error) => {
      debugLog('上游流错误: %o', error);
      res.end();
    });

  } catch (error) {
    debugLog('调用上游失败: %o', error);
    res.status(502).json({ error: 'Failed to call upstream' });
  }
}

// 处理非流式响应
async function handleNonStreamResponseWithIDs(res, upstreamReq, chatID, authToken) {
  debugLog('开始处理非流式响应 (chat_id=%s)', chatID);

  try {
    const response = await callUpstreamWithHeaders(upstreamReq, chatID, authToken);
    
    if (response.status !== 200) {
      debugLog('上游返回错误状态: %d', response.status);
      return res.status(502).json({ error: 'Upstream error' });
    }

    // 收集完整响应（策略2：thinking与answer都纳入，thinking转换）
    let fullContent = '';
    let isDone = false;

    debugLog('开始收集完整响应内容');

    response.data.on('data', (chunk) => {
      if (isDone) return;

      const data = chunk.toString();
      const lines = data.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) {
          continue;
        }

        const dataStr = line.substring(6); // 去掉 'data: '
        if (dataStr === '') {
          continue;
        }

        try {
          const upstreamData = JSON.parse(dataStr);

          if (upstreamData.data && upstreamData.data.delta_content) {
            let out = upstreamData.data.delta_content;
            
            if (upstreamData.data.phase === 'thinking') {
              // 同步一份转换逻辑（与流式一致）
              out = out.replace(/<summary>.*?<\/summary>/gs, '');
              out = out.replace(/<\/thinking>/g, '');
              out = out.replace(/<Full>/g, '');
              out = out.replace(/<\/Full>/g, '');
              out = out.trim();
              
              switch (THINK_TAGS_MODE) {
                case 'think':
                  out = out.replace(/<details[^>]*>/g, '<span>');
                  out = out.replace(/<\/details>/g, '</span>');
                  break;
                case 'strip':
                  out = out.replace(/<details[^>]*>/g, '');
                  out = out.replace(/<\/details>/g, '');
                  break;
              }
              
              out = out.replace(/^> /, '');
              out = out.replace(/\n> /g, '\n');
              out = out.trim();
            }
            
            if (out) {
              fullContent += out;
            }
          }

          if (upstreamData.data && (upstreamData.data.done || upstreamData.data.phase === 'done')) {
            debugLog('检测到完成信号，停止收集');
            isDone = true;
            return;
          }
        } catch (error) {
          // 忽略解析错误
        }
      }
    });

    response.data.on('end', () => {
      debugLog('内容收集完成，最终长度: %d', fullContent.length);

      // 构造完整响应
      const response = {
        id: `chatcmpl-${Math.floor(Date.now() / 1000)}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: MODEL_NAME,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: fullContent
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };

      res.setHeader('Content-Type', 'application/json');
      res.json(response);
      debugLog('非流式响应发送完成');
    });

    response.data.on('error', (error) => {
      debugLog('上游流错误: %o', error);
      res.status(502).json({ error: 'Failed to call upstream' });
    });

  } catch (error) {
    debugLog('调用上游失败: %o', error);
    res.status(502).json({ error: 'Failed to call upstream' });
  }
}

// 404处理
app.use('*', (req, res) => {
  setCORSHeaders(res);
  res.status(404).json({ error: 'Not Found' });
});

// 启动服务器
server.listen(PORT, () => {
  console.log(`OpenAI兼容API服务器启动在端口${PORT}`);
  console.log(`模型: ${MODEL_NAME}`);
  console.log(`上游: ${UPSTREAM_URL}`);
  console.log(`Debug模式: ${DEBUG_MODE}`);
});