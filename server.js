// server.js
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// 新增的音频处理依赖
const ytdl = require('yt-dlp-exec');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const fs = require('fs/promises');
const path = require('path');
const sqlite3 = require('sqlite3').verbose(); // 引入 sqlite3

// 配置 ffmpeg 路径
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);


const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// --- Database Setup ---
const dbPath = path.join(__dirname, 'db.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS summaries (
            video_id TEXT PRIMARY KEY,
            summary TEXT NOT NULL,
            created_at TEXT NOT NULL
        )`, (err) => {
            if (err) {
                console.error('Error creating table', err.message);
            } else {
                console.log('Table "summaries" is ready.');
            }
        });
    }
});

// Promise-based wrappers for DB operations
function dbGet(query, params) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function dbRun(query, params) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}


// 初始化 Gemini AI
if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set in .env file");
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const summaryModel = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
const transcriptionModel = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

const tasks = new Map(); // 用于存储异步任务状态的内存数据库

// --- 辅助函数 ---

/**
 * 格式化秒数为 [HH:MM:SS] 格式
 * @param {number} seconds - 总秒数
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}

/**
 * 将带时间戳的字幕数据格式化为单个字符串
 * @param {Array<object>} transcriptData - 字幕数据数组
 * @returns {string} 格式化后的字幕字符串
 */
function formatTranscriptWithTimestamps(transcriptData) {
    // 使用 map 将每个字幕条目转换为带时间戳的格式，然后用换行符连接
    return transcriptData.map(entry => `[${formatTime(entry.start)}] ${entry.text}`).join('\n');
}

/**
 * 从 YouTube URL 中提取视频 ID
 * @param {string} url - YouTube URL.
 * @returns {string|null} 视频 ID 或 null.
 */
function getVideoId(url) {
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname === 'youtu.be') {
            return urlObj.pathname.slice(1);
        }
        if (urlObj.hostname.includes('youtube.com')) {
            return urlObj.searchParams.get('v');
        }
        return null;
    } catch (error) {
        console.error('无效的 URL:', url, error);
        return null;
    }
}

/**
 * 使用 Gemini Pro 总结给定的文本
 * @param {string} text - 需要总结的文本.
 * @returns {Promise<string>} 总结内容.
 */
async function summarizeText(text) {
    const prompt = `请用繁体中文，根据以下内容总结出 5-10 个关键要点，并以项目符号列表（bullet points）的形式呈现。如果内容中包含时间戳（例如 [HH:MM:SS]），请在对应的要点后附上时间戳范围，以帮助定位。\n\n内容:\n"""\n${text}\n"""\n\n摘要:`;
    const result = await summaryModel.generateContent(prompt);
    return result.response.text();
}

/**
 * 将文件转换为 Gemini API 需要的 Part 对象
 * @param {string} filePath - 文件路径.
 * @param {string} mimeType - 文件的 MIME 类型.
 * @returns {Promise<object>} Gemini Part 对象.
 */
async function fileToGenerativePart(filePath, mimeType) {
    return {
        inlineData: {
            data: Buffer.from(await fs.readFile(filePath)).toString("base64"),
            mimeType,
        },
    };
}

// --- API 端点 ---

app.post('/summarize', (req, res) => {
    const { videoUrl } = req.body;
    if (!videoUrl) {
        return res.status(400).json({ error: 'videoUrl is required.' });
    }

    const videoId = getVideoId(videoUrl);
    if (!videoId) {
        return res.status(400).json({ error: 'Invalid or unsupported YouTube URL' });
    }

    const taskId = uuidv4();
    tasks.set(taskId, { status: 'processing', data: null });

    // 立即响应，告知客户端任务已开始，并返回任务ID
    res.status(202).json({ taskId });

    // 在后台执行耗时操作，不阻塞响应
    processVideo(videoUrl, videoId, taskId);
});

app.get('/status/:taskId', (req, res) => {
    const { taskId } = req.params;
    const task = tasks.get(taskId);

    if (!task) {
        return res.status(404).json({ error: 'Task not found.' });
    }

    res.json(task);
});

async function processVideo(videoUrl, videoId, taskId) {
    console.log(`[${videoId}] 开始处理请求...`);

    try {
        // 首先，检查缓存
        const cached = await dbGet("SELECT summary FROM summaries WHERE video_id = ?", [videoId]);
        if (cached && cached.summary) {
            console.log(`[${videoId}] 找到缓存的摘要。`);
            tasks.set(taskId, { status: 'complete', data: { summary: cached.summary, source: 'cache' } });
            return; // 找到缓存，直接结束任务
        }
        console.log(`[${videoId}] 未找到缓存，开始实时处理...`);

        // 根据操作系统确定 Python 虚拟环境的可执行文件路径
        const pythonExecutable = process.platform === 'win32'
            ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
            : path.join(__dirname, '.venv', 'bin', 'python');
        const transcriptScriptPath = path.join(__dirname, 'get_transcript.py');

        // 阶段一: 尝试用 Python 脚本获取字幕
        const pythonProcess = spawn(pythonExecutable, [transcriptScriptPath, videoId]);

        let transcriptData = '';
        let errorData = '';
        pythonProcess.stdout.on('data', (data) => { transcriptData += data.toString(); });
        pythonProcess.stderr.on('data', (data) => { errorData += data.toString(); });

        pythonProcess.on('close', async (code) => {
            if (code !== 0) {
                const errorMsg = `执行字幕脚本失败: ${errorData}`;
                console.error(`[${videoId}] Python 脚本执行失败，代码 ${code}: ${errorMsg}`);
                tasks.set(taskId, { status: 'error', data: { error: errorMsg } });
                return;
            }

            try {
                const { transcript } = JSON.parse(transcriptData);
                let summary; // 将 summary 声明在外部

                // 如果 transcript 是一个非空数组，说明有字幕
                if (transcript && Array.isArray(transcript) && transcript.length > 0) {
                    // --- 找到字幕，直接总结 ---
                    console.log(`[${videoId}] 找到带时间戳的字幕，正在格式化并总结...`);
                    const formattedTranscript = formatTranscriptWithTimestamps(transcript);
                    summary = await summarizeText(formattedTranscript); // 赋值给 summary
                    console.log(`[${videoId}] 总结生成成功。`);
                } else {
                    // --- 未找到字幕，处理音频 ---
                    console.log(`[${videoId}] 未找到字幕，启动音频转文字流程。`);
                    summary = await handleAudioProcessing(videoUrl, videoId); // handleAudioProcessing 现在只返回总结
                }
                
                // 将新生成的总结存入缓存
                console.log(`[${videoId}] 正在将新生成的摘要存入缓存...`);
                await dbRun("INSERT INTO summaries (video_id, summary, created_at) VALUES (?, ?, ?)", [videoId, summary, new Date().toISOString()]);
                console.log(`[${videoId}] 缓存成功。`);

                // 更新任务状态
                tasks.set(taskId, { status: 'complete', data: { summary } });

            } catch (error) { // 这个 catch 捕获总结或音频处理的错误
                console.error(`[${videoId}] 总结或音频处理流程出错:`, error);
                tasks.set(taskId, { status: 'error', data: { error: `服务器内部错误: ${error.message}` } });
            }
        });
    } catch (error) { // 这个 catch 捕获检查缓存或启动进程前的错误
        console.error(`[${videoId}] 处理请求时出错:`, error);
        tasks.set(taskId, { status: 'error', data: { error: `服务器内部错误: ${error.message}` } });
    }
}


// --- 音频处理逻辑 ---

/**
 * 处理完整的音频流程：下载、切块、转写、总结
 * @param {string} videoUrl - 完整的 YouTube 视频 URL.
 * @param {string} videoId - 视频 ID.
 * @returns {Promise<string>} 总结内容.
 */
async function handleAudioProcessing(videoUrl, videoId) {
    const tempDir = path.join(__dirname, 'temp', videoId);
    const audioPath = path.join(tempDir, 'audio.mp3');

    try {
        await fs.mkdir(tempDir, { recursive: true });

        // 1. 使用 yt-dlp-exec 下载音频
        console.log(`[${videoId}] 正在下载音频...`);
        await ytdl(videoUrl, {
            extractAudio: true,
            audioFormat: 'mp3',
            output: audioPath,
        });
        console.log(`[${videoId}] 音频已下载至 ${audioPath}`);

        // 2. 获取音频时长以决定是否切块
        const getDuration = (filePath) => new Promise((resolve, reject) => {
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) return reject(err);
                resolve(metadata.format.duration);
            });
        });

        const duration = await getDuration(audioPath);
        console.log(`[${videoId}] 音频时长: ${Math.round(duration)} 秒。`);

        const chunkDuration = 540; // 每个分块 9 分钟，安全适配 Gemini 的限制
        const chunkPaths = [];

        // 3. 如果需要，将音频分割成块
        if (duration > chunkDuration) {
            console.log(`[${videoId}] 音频较长，正在准备并行切块...`);
            const chunkPromises = [];
            for (let i = 0; i < duration; i += chunkDuration) {
                const chunkIndex = Math.floor(i / chunkDuration);
                const chunkPath = path.join(tempDir, `chunk_${chunkIndex}.mp3`);
                chunkPaths.push(chunkPath);

                const chunkPromise = new Promise((resolve, reject) => {
                    ffmpeg(audioPath)
                        .setStartTime(i)
                        .setDuration(chunkDuration)
                        .output(chunkPath)
                        .on('end', () => {
                            console.log(`[${videoId}] 已创建分块 ${chunkIndex}。`);
                            resolve(chunkPath);
                        })
                        .on('error', (err) => {
                            console.error(`[${videoId}] 创建分块 ${chunkIndex} 时出错: ${err.message}`);
                            reject(err);
                        })
                        .run();
                });
                chunkPromises.push(chunkPromise);
            }
            await Promise.all(chunkPromises);
            console.log(`[${videoId}] 所有分块创建完成。`);
        } else {
            console.log(`[${videoId}] 音频较短，无需切块。`);
            chunkPaths.push(audioPath);
        }

        // 4. 并发转写所有音频块
        console.log(`[${videoId}] 正在转写 ${chunkPaths.length} 个音频分块...`);
        const transcriptionPromises = chunkPaths.map(async (chunkPath, index) => {
            const audioPart = await fileToGenerativePart(chunkPath, "audio/mp3");
            const prompt = "这是一个 YouTube 视频的一部分。请准确地转写音频。内容可能是中文、英文或两者混合。";
            const result = await transcriptionModel.generateContent([prompt, audioPart]);
            console.log(`[${videoId}] 分块 ${index} 转写完成。`);
            return result.response.text();
        });

        const transcriptions = await Promise.all(transcriptionPromises);
        const fullTranscript = transcriptions.join(' ');
        console.log(`[${videoId}] 已从音频生成完整文稿。`);
        
        if (!fullTranscript || fullTranscript.trim().length === 0) {
            throw new Error("转写结果为空。");
        }

        // 5. 总结转写后的完整文稿
        console.log(`[${videoId}] 正在总结生成的文稿...`);
        const summary = await summarizeText(fullTranscript);
        console.log(`[${videoId}] 已从音频成功生成总结。`);
        return summary;

    } catch (err) {
        console.error(`[${videoId}] 音频处理流程出错:`, err.message);
        throw new Error(`处理视频音频失败: ${err.message}`);
    } finally {
        // 7. 清理临时文件
        console.log(`[${videoId}] 正在清理临时文件...`);
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
            console.log(`[${videoId}] 临时目录已清理。`);
        } catch (cleanupError) {
            console.error(`[${videoId}] 清理临时文件时出错:`, cleanupError);
        }
    }
}

app.listen(port, () => {
    console.log(`服务器正在 http://localhost:${port} 监听...`);
});