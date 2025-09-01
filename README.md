# ZAI2API - OpenAI兼容API服务器 (Node.js版本)

这是一个将Go语言版本的OpenAI兼容API服务器转换为Node.js版本的项目，支持Docker一键部署。

## 功能特性

- OpenAI API兼容接口
- 代理请求到z.ai上游API
- 支持流式和非流式响应
- 处理思考内容（thinking content）
- 支持CORS
- 支持API Key验证
- 支持获取匿名token
- Docker一键部署

## 快速开始

### 本地运行

1. 克隆项目
```bash
git clone <repository-url>
cd zai2api
```

2. 安装依赖
```bash
npm install
```

3. 启动服务
```bash
npm start
```

或者使用开发模式（支持热重载）：
```bash
npm run dev
```

服务将在 `http://localhost:5566` 启动。

### Docker部署

1. 构建Docker镜像
```bash
docker build -t zai2api .
```

2. 运行容器
```bash
docker run -p 5566:5566 --name zai2api zai2api
```

或者使用docker-compose（推荐）：
```bash
docker-compose up -d
```

## 配置

### 环境变量

可以通过环境变量配置服务：

```bash
# 服务端口（默认：5566）
PORT=5566

# 调试模式（默认：true）
DEBUG_MODE=true
```

### 配置文件

所有配置常量都集中在 `config.js` 文件中，包括：

- `UPSTREAM_URL`: 上游API地址
- `DEFAULT_KEY`: 下游客户端鉴权key
- `UPSTREAM_TOKEN`: 上游API的token（回退用）
- `MODEL_NAME`: 模型名称
- `THINK_TAGS_MODE`: 思考内容处理策略
- `ANON_TOKEN_ENABLED`: 匿名token开关
- `UPSTREAM_MODEL_ID`: 上游实际模型ID
- 伪装前端头部相关配置

## API使用

### 模型列表

```bash
curl -X GET http://localhost:5566/v1/models \
  -H "Authorization: Bearer sk-your-key"
```

### 聊天完成（非流式）

```bash
curl -X POST http://localhost:5566/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-key" \
  -d '{
    "model": "GLM-4.5",
    "messages": [
      {"role": "user", "content": "你好，请介绍一下你自己"}
    ]
  }'
```

### 聊天完成（流式）

```bash
curl -X POST http://localhost:5566/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-key" \
  -d '{
    "model": "GLM-4.5",
    "messages": [
      {"role": "user", "content": "你好，请介绍一下你自己"}
    ],
    "stream": true
  }'
```

## 项目结构

```
zai2api/
├── package.json          # 项目依赖和脚本
├── server.js            # 主服务器文件
├── config.js            # 配置文件
├── Dockerfile           # Docker构建文件
├── .dockerignore        # Docker忽略文件
└── README.md            # 项目说明文档
```

## 注意事项

1. 默认API Key为 `sk-your-key`，请在生产环境中修改为安全的值
2. 上游token和URL可以根据实际需求修改
3. 调试模式在生产环境中建议关闭
4. 确保服务器网络可以访问上游API

## 许可证

MIT