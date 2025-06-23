import { Client, GatewayIntentBits, Message, Attachment, PartialMessage, EmbedBuilder, TextChannel } from 'discord.js';
import dotenv from 'dotenv';
import { IdeaManager } from './services/ideaManager';
import { TranscriptionService } from './services/transcription';
import { ArticleScraper } from './services/articleScraper';
import { ArticleSummarizer } from './services/articleSummarizer';
import { ArxivService } from './services/arxivService';
import { PaperSummarizer } from './services/paperSummarizer';
import * as path from 'path';
import * as http from 'http';

// 簡単なHTTPサーバーを追加（Render.com用）
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord Voice Transcriber Bot is running!');
});

server.listen(PORT, () => {
  console.log(`🚀 Health check server listening on port ${PORT}`);
});

// 環境変数を読み込む
dotenv.config();

// 各サービスを初期化
const ideaManager = new IdeaManager();
const transcriptionService = new TranscriptionService();
const articleScraper = new ArticleScraper();
const articleSummarizer = new ArticleSummarizer(process.env.GOOGLE_AI_API_KEY!);
const arxivService = new ArxivService();
const paperSummarizer = new PaperSummarizer(process.env.GOOGLE_AI_API_KEY!);

// 論文検索用の一時保存
let lastPaperSearch: { channelId: string; papers: any[] } | null = null;

// 論文検索のカテゴリー定義
const paperCategories: Record<string, { name: string; query: string }> = {
    '1': { name: 'AI・機械学習', query: 'artificial intelligence OR machine learning OR deep learning' },
    '2': { name: '自然言語処理', query: 'natural language processing OR NLP OR transformer' },
    '3': { name: 'コンピュータビジョン', query: 'computer vision OR image recognition OR object detection' },
    '4': { name: 'ロボティクス', query: 'robotics OR robot control OR autonomous systems' },
    '5': { name: '量子コンピュータ', query: 'quantum computing OR quantum algorithm OR quantum machine learning' },
    '6': { name: '医療・ヘルスケアAI', query: 'medical AI OR healthcare artificial intelligence OR clinical ML' },
    '7': { name: '建設・建築技術', query: 'construction technology OR BIM OR civil engineering' },
    '8': { name: '自動運転', query: 'autonomous driving OR self-driving car OR vehicle automation' },
    '9': { name: 'セキュリティ・暗号', query: 'cybersecurity OR cryptography OR blockchain' }
};

// Discordクライアントを作成
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// 対象チャンネルのリスト
const targetChannels = [
    '執筆アイデア', 'aiアイデア', 'プロンプトアイデア',
    'devアイデア', 'ひらめき', 'discord-develop', 'meeting', '論文収集'
];

// URL検出の正規表現
const URL_REGEX = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;

// 音声ファイルかどうかチェック
function isVoiceFile(attachment: Attachment): boolean {
    const voiceExtensions = ['.ogg', '.mp3', '.wav', '.m4a'];
    return voiceExtensions.some(ext => 
        attachment.name?.toLowerCase().endsWith(ext)
    );
}

// チャンネルがテキストベースかチェック
function isTextBasedChannel(channel: any): channel is TextChannel {
    return 'send' in channel;
}

// Botが起動したときの処理
client.once('ready', () => {
    console.log(`✅ ${client.user?.tag} が起動しました！`);
    console.log('📝 監視中のチャンネル:', targetChannels.join(', '));
    console.log('🌐 記事自動要約機能: 有効');
    console.log('📚 論文収集機能: 有効');
    
    // デバッグ情報を追加
    console.log('📁 Obsidian Vault Path:', process.env.OBSIDIAN_VAULT_PATH);
    console.log('📁 Discord_memo Path:', path.join(process.env.OBSIDIAN_VAULT_PATH || '', 'AI_MEMO', 'Discord_memo'));
});

// メッセージを受信したときの処理
client.on('messageCreate', async (message: Message) => {
    // Botのメッセージは無視
    if (message.author.bot) return;
    
    // チャンネル名をチェック
    const channelName = 'name' in message.channel ? message.channel.name : null;
    
    // コマンド処理（どのチャンネルでも実行可能）
    if (message.content.startsWith('!')) {
        await handleCommand(message);
        return;
    }
    
    // 対象チャンネルでのみアイデア保存
    if (!channelName || !targetChannels.includes(channelName)) return;

    try {
        // URLが含まれているかチェック
        const urls = message.content.match(URL_REGEX);
        
        if (urls && urls.length > 0) {
            // URLが含まれている場合は記事として処理
            console.log(`🌐 URLを検出: ${urls.length}件`);
            for (const url of urls) {
                await processArticleURL(message, url, channelName);
            }
            return; // URLの処理が終わったらreturn
        }

        // 音声ファイルが含まれているかチェック
        const voiceAttachment = message.attachments.find(attachment => 
            isVoiceFile(attachment)
        );

        if (voiceAttachment) {
            // 音声ファイルの場合
            console.log(`🎤 音声ファイルを検出: ${voiceAttachment.name}`);
            await message.react('🎤');
            
            try {
                // 処理中のメッセージを送信
                const processingMsg = await message.reply('🎙️ 音声を文字起こし中...');
                
                // 音声文字起こし処理
                const transcription = await transcriptionService.transcribeAudio(
                    voiceAttachment.url,
                    voiceAttachment.contentType || 'audio/ogg'
                );
                
                // 文字起こし結果を保存
                const idea = await ideaManager.addIdea(channelName, transcription, 'voice');
                
                // 処理完了メッセージ
                await processingMsg.edit(`✅ アイデア #${idea.id} として保存しました！\n\n**文字起こし結果:**\n${transcription.substring(0, 200)}${transcription.length > 200 ? '...' : ''}`);
                
            } catch (error) {
                console.error('❌ 音声処理エラー:', error);
                await message.reply('❌ 音声の文字起こしに失敗しました。');
            }
            
        } else if (message.content.trim()) {
            // テキストメッセージの場合（URLなし）
            console.log(`📝 新しいメッセージ: ${message.content}`);
            await message.react('💡');
            
            // アイデアとして保存
            const idea = await ideaManager.addIdea(channelName, message.content, 'text');
            await message.reply(`✅ アイデア #${idea.id} として保存しました！`);
        }
    } catch (error) {
        console.error('❌ エラー:', error);
        await message.react('❌');
    }
});

// URL処理関数
async function processArticleURL(message: Message, url: string, channelName: string) {
    let processingMsg: Message | null = null;
    
    try {
        // 処理中メッセージ
        processingMsg = await message.reply(`📰 記事を取得中... (${url})`);
        await message.react('📰');
        
        // 記事の取得
        const articleData = await articleScraper.scrapeArticle(url);
        
        // 記事が短すぎる場合はスキップ
        if (articleData.content.length < 100) {
            await processingMsg.edit('⚠️ 記事の内容が取得できませんでした。');
            return;
        }
        
        // 要約の生成
        await processingMsg.edit('🤖 記事を要約中...');
        const summary = await articleSummarizer.summarizeArticle(articleData);
        
        // タグの生成
        const tags = articleSummarizer.generateTags(articleData, summary);
        
        // アイデアとして保存
        const idea = await ideaManager.addArticleIdea(
            channelName,
            url,
            articleData,
            summary,
            tags
        );
        
        // 完了メッセージ
        const responseMessage = `✅ 記事を要約して保存しました！

**#${idea.id}** ${articleData.title}
${articleData.siteName ? `📰 ${articleData.siteName}` : ''}${articleData.author ? ` / ${articleData.author}` : ''}

📝 **要約:**
${summary.length > 400 ? summary.substring(0, 400) + '...' : summary}

🏷️ ${tags.map(t => `#${t}`).join(' ')}`;

        await processingMsg.edit(responseMessage);
        await message.react('✅');
        
    } catch (error) {
        console.error('❌ 記事処理エラー:', error);
        
        if (processingMsg) {
            await processingMsg.edit('❌ 記事の処理に失敗しました。URLが正しいか確認してください。');
        } else {
            await message.reply('❌ 記事の処理に失敗しました。');
        }
        
        await message.react('❌');
    }
}

// コマンド処理
async function handleCommand(message: Message) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    switch (command) {
        case 'list':
        case 'リスト':
            await handleListCommand(message, args);
            break;
            
        case 'help':
        case 'ヘルプ':
            await handleHelpCommand(message);
            break;
            
        case 'debug':
        case 'デバッグ':
            await handleDebugCommand(message);
            break;

        case 'test':
        case 'テスト':
            await handleTestCommand(message);
            break;
            
        case 'stats':
        case '統計':
            await handleStatsCommand(message);
            break;
            
        case 'paper':
        case '論文':
            await handlePaperCommand(message, args);
            break;
            
        default:
            await message.reply('❓ 不明なコマンドです。`!help` でヘルプを表示します。');
    }
}

// 論文コマンド処理
async function handlePaperCommand(message: Message, args: string[]) {
    const subCommand = args[0];
    
    // チャンネルがテキストベースでない場合は処理しない
    if (!isTextBasedChannel(message.channel)) {
        await message.reply('このチャンネルではこのコマンドは使用できません。');
        return;
    }
    
    // 番号での選択処理
    if (subCommand === 'select' || subCommand === '選択') {
        // 複数選択に対応
        const selections = args.slice(1).join(' ');
        
        if (!selections) {
            await message.reply('選択する論文の番号を指定してください。例: `!paper select 1,3,5` または `!paper select 1-3`');
            return;
        }
        
        if (!lastPaperSearch || lastPaperSearch.channelId !== message.channel.id) {
            await message.reply('先に論文を検索してください。');
            return;
        }
        
        // 選択番号をパース（カンマ区切り、範囲指定、スペース区切りに対応）
        const selectedNumbers: number[] = [];
        
        // カンマまたはスペースで分割
        const parts = selections.split(/[,\s]+/);
        
        for (const part of parts) {
            // 範囲指定（例: 1-3）
            if (part.includes('-')) {
                const [start, end] = part.split('-').map(n => parseInt(n.trim()));
                if (!isNaN(start) && !isNaN(end)) {
                    for (let i = start; i <= end; i++) {
                        selectedNumbers.push(i);
                    }
                }
            } else {
                // 単一の番号
                const num = parseInt(part.trim());
                if (!isNaN(num)) {
                    selectedNumbers.push(num);
                }
            }
        }
        
        // 重複を除去し、ソート
        const uniqueNumbers = [...new Set(selectedNumbers)].sort((a, b) => a - b);
        
        // 有効な番号のみフィルタ
        const validNumbers = uniqueNumbers.filter(
            num => num >= 1 && num <= (lastPaperSearch?.papers.length || 0)
        );
        
        if (validNumbers.length === 0) {
            await message.reply(`1から${lastPaperSearch.papers.length}の番号を指定してください。`);
            return;
        }
        
        // 処理開始メッセージ
        const processingEmbed = new EmbedBuilder()
            .setColor(0xFFFF00)
            .setTitle('🤖 論文を処理中...')
            .setDescription(`${validNumbers.length}件の論文を要約します`)
            .setFooter({ text: '少々お待ちください...' });
        
        const processingMsg = await message.channel.send({ embeds: [processingEmbed] });
        
        // 成功した論文を記録
        const successfulPapers: { paper: any; idea: any; summary: any }[] = [];
        const failedPapers: { paper: any; error: string }[] = [];
        
        // 各論文を順番に処理
        for (let i = 0; i < validNumbers.length; i++) {
            const num = validNumbers[i];
            const selectedPaper = arxivService.getSearchResult(num - 1);
            
            if (!selectedPaper) {
                failedPapers.push({ 
                    paper: { title: `論文 #${num}` }, 
                    error: '選択に失敗しました' 
                });
                continue;
            }
            
            // 進行状況を更新
            const progressEmbed = new EmbedBuilder()
                .setColor(0xFFFF00)
                .setTitle('🤖 論文を処理中...')
                .setDescription(`処理中: ${i + 1}/${validNumbers.length}件`)
                .addFields({
                    name: '現在の論文',
                    value: selectedPaper.title.substring(0, 100) + '...',
                    inline: false
                })
                .setFooter({ text: `進行状況: ${Math.round((i + 1) / validNumbers.length * 100)}%` });
            
            await processingMsg.edit({ embeds: [progressEmbed] });
            
            try {
                // 論文を要約
                const summary = await paperSummarizer.summarizePaper(selectedPaper);
                
                // アイデアとして保存
                const idea = await ideaManager.addPaperIdea(
                    {
                        arxivId: selectedPaper.arxivId,
                        title: selectedPaper.title,
                        authors: selectedPaper.authors,
                        publishedDate: selectedPaper.published.toISOString(),
                        categories: selectedPaper.categories,
                        pdfUrl: selectedPaper.pdfUrl,
                        abstract: selectedPaper.abstract
                    },
                    summary
                );
                
                successfulPapers.push({ paper: selectedPaper, idea, summary });
                
            } catch (error) {
                console.error(`論文 #${num} の処理エラー:`, error);
                failedPapers.push({ 
                    paper: selectedPaper, 
                    error: '要約に失敗しました' 
                });
            }
            
            // レート制限を考慮して少し待機
            if (i < validNumbers.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        // 結果をまとめて表示
        const resultEmbed = new EmbedBuilder()
            .setColor(successfulPapers.length > 0 ? 0x00FF00 : 0xFF0000)
            .setTitle('📚 論文処理完了')
            .setDescription(
                `✅ 成功: ${successfulPapers.length}件\n` +
                `❌ 失敗: ${failedPapers.length}件`
            );
        
        // 成功した論文のリスト
        if (successfulPapers.length > 0) {
            const successList = successfulPapers.map(({ paper, idea }, index) => {
                const shortTitle = paper.title.length > 50 
                    ? paper.title.substring(0, 50) + '...' 
                    : paper.title;
                return `**#${idea.id}** ${shortTitle}`;
            }).join('\n');
            
            resultEmbed.addFields({
                name: '✅ 保存された論文',
                value: successList.substring(0, 1024), // Discordのフィールド文字数制限
                inline: false
            });
            
            // タグをまとめて表示
            const allTags = new Set<string>();
            successfulPapers.forEach(({ summary }) => {
                summary.tags.forEach((tag: string) => allTags.add(tag));
            });
            
            if (allTags.size > 0) {
                resultEmbed.addFields({
                    name: '🏷️ 関連タグ',
                    value: Array.from(allTags).map(tag => `#${tag}`).join(' '),
                    inline: false
                });
            }
        }
        
        // 失敗した論文のリスト
        if (failedPapers.length > 0) {
            const failList = failedPapers.map(({ paper, error }) => {
                const shortTitle = paper.title.length > 50 
                    ? paper.title.substring(0, 50) + '...' 
                    : paper.title;
                return `${shortTitle} - ${error}`;
            }).join('\n');
            
            resultEmbed.addFields({
                name: '❌ 処理に失敗した論文',
                value: failList.substring(0, 1024),
                inline: false
            });
        }
        
        resultEmbed.setFooter({ 
            text: `Obsidianに保存されました | 処理時間: ${validNumbers.length * 1.5}秒` 
        });
        
        await processingMsg.edit({ embeds: [resultEmbed] });
        
        // 処理完了の通知
        if (successfulPapers.length > 0) {
            await message.react('✅');
        } else {
            await message.react('❌');
        }
        
        return;
    }
    
    // メインメニューを表示（引数なしで!論文を実行した場合）
    if (!subCommand) {
        const menuEmbed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('📚 論文検索メニュー')
            .setDescription('検索したいカテゴリーの番号を入力してください')
            .addFields(
                Object.entries(paperCategories).map(([num, cat]) => ({
                    name: `${num}. ${cat.name}`,
                    value: '　',  // 空白文字で高さを確保
                    inline: true
                }))
            )
            .addFields([
                { name: '\u200B', value: '\u200B', inline: false }, // 改行
                { name: '💡 使い方', value: '`!論文 1` のように番号を入力\n`!論文 AIロボット` のように自由検索も可能', inline: false }
            ])
            .setFooter({ text: '最新の研究論文をarXivから検索します' });
        
        await message.channel.send({ embeds: [menuEmbed] });
        return;
    }
    
    // カテゴリー番号が入力された場合
    if (subCommand && paperCategories[subCommand]) {
        const category = paperCategories[subCommand];
        await message.channel.send(`🔍 「${category.name}」の最新論文を検索中...`);
        
        try {
            const papers = await arxivService.searchPapers(category.query, 10);
            
            if (papers.length === 0) {
                await message.channel.send('論文が見つかりませんでした。');
                return;
            }
            
            // 検索結果を保存
            lastPaperSearch = { channelId: message.channel.id, papers };
            
            // 結果を表示
            const resultsEmbed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle(`📚 ${category.name}の検索結果`)
                .setDescription('読みたい論文の番号を選択してください')
                .setFooter({ text: `${papers.length}件の論文が見つかりました | 選択: !paper select [番号]` });
            
            papers.forEach((paper, index) => {
                const date = paper.published.toLocaleDateString('ja-JP');
                const authors = paper.authors.slice(0, 2).join(', ');
                const authorText = paper.authors.length > 2 ? `${authors} 他` : authors;
                
                // タイトルを短く表示
                const shortTitle = paper.title.length > 60 
                    ? paper.title.substring(0, 60) + '...' 
                    : paper.title;
                
                resultsEmbed.addFields({
                    name: `${index + 1}. ${shortTitle}`,
                    value: `👥 ${authorText} | 📅 ${date}`,
                    inline: false
                });
            });
            
            await message.channel.send({ embeds: [resultsEmbed] });
            
        } catch (error) {
            console.error('論文検索エラー:', error);
            await message.channel.send('❌ 論文の検索中にエラーが発生しました。');
        }
        return;
    }
    
    // 自由検索（番号以外のテキストが入力された場合）
    const freeSearchQuery = args.join(' ');
    await message.channel.send(`🔍 「${freeSearchQuery}」を検索中...`);
    
    try {
        // 日本語を英語に変換
        const englishQuery = await paperSummarizer.translateSearchQuery(freeSearchQuery);
        await message.channel.send(`🌐 検索キーワード: ${englishQuery}`);
        
        const papers = await arxivService.searchPapers(englishQuery, 10);
        
        if (papers.length === 0) {
            await message.channel.send('論文が見つかりませんでした。別のキーワードで試してみてください。');
            return;
        }
        
        // 検索結果を保存
        lastPaperSearch = { channelId: message.channel.id, papers };
        
        // 結果を表示（カテゴリー検索と同じフォーマット）
        const resultsEmbed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle(`📚 「${freeSearchQuery}」の検索結果`)
            .setDescription('読みたい論文の番号を選択してください')
            .setFooter({ text: `${papers.length}件の論文が見つかりました | 選択: !paper select [番号]` });
        
        papers.forEach((paper, index) => {
            const date = paper.published.toLocaleDateString('ja-JP');
            const authors = paper.authors.slice(0, 2).join(', ');
            const authorText = paper.authors.length > 2 ? `${authors} 他` : authors;
            
            const shortTitle = paper.title.length > 60 
                ? paper.title.substring(0, 60) + '...' 
                : paper.title;
            
            resultsEmbed.addFields({
                name: `${index + 1}. ${shortTitle}`,
                value: `👥 ${authorText} | 📅 ${date}`,
                inline: false
            });
        });
        
        await message.channel.send({ embeds: [resultsEmbed] });
        
    } catch (error) {
        console.error('論文検索エラー:', error);
        await message.channel.send('❌ 論文の検索中にエラーが発生しました。');
    }
}

// リストコマンド
async function handleListCommand(message: Message, args: string[]) {
    const channel = args[0];
    const ideas = ideaManager.getRecentIdeas(10, channel);
    
    if (ideas.length === 0) {
        await message.reply('📝 アイデアがまだありません。');
        return;
    }
    
    let response = channel 
        ? `📋 **${channel}** の最近のアイデア:\n\n`
        : '📋 **最近のアイデア一覧:**\n\n';
    
    ideas.forEach(idea => {
        const date = new Date(idea.createdAt).toLocaleString('ja-JP');
        const typeIcon = idea.type === 'voice' ? '🎤' : 
                        idea.type === 'article' ? '📰' : 
                        idea.type === 'paper' ? '📚' : '💡';
        const tags = idea.tags.length > 0 ? ` [${idea.tags.map(t => `#${t}`).join(' ')}]` : '';
        
        response += `${typeIcon} **#${idea.id}** - ${idea.channel} - ${date}${tags}\n`;
        
        if (idea.type === 'article') {
            const articleIdea = idea as any;
            response += `   📎 ${articleIdea.articleData.title.substring(0, 50)}${articleIdea.articleData.title.length > 50 ? '...' : ''}\n`;
        } else if (idea.type === 'paper') {
            const paperIdea = idea as any;
            const title = paperIdea.paperMetadata.arxivId;
            response += `   📎 arXiv:${title}\n`;
        } else {
            response += `   ${idea.content.substring(0, 50)}${idea.content.length > 50 ? '...' : ''}\n`;
        }
        response += '\n';
    });
    
    await message.reply(response);
}

// 統計コマンド
async function handleStatsCommand(message: Message) {
    const stats = ideaManager.getStats();
    
    let response = `📊 **アイデア統計情報**

**総数**: ${stats.total}件
- 💡 テキスト: ${stats.text}件
- 🎤 音声: ${stats.voice}件
- 📰 記事: ${stats.article}件
- 📚 論文: ${stats.paper}件

**チャンネル別**:
`;
    
    Object.entries(stats.byChannel).forEach(([channel, count]) => {
        response += `- #${channel}: ${count}件\n`;
    });
    
    await message.reply(response);
}

// デバッグコマンド
async function handleDebugCommand(message: Message) {
    const stats = ideaManager.getStats();
    const debugInfo = `
🔧 **デバッグ情報**

**環境変数:**
- Obsidian Path: \`${process.env.OBSIDIAN_VAULT_PATH}\`
- Discord_memo Path: \`${path.join(process.env.OBSIDIAN_VAULT_PATH || '', 'AI_MEMO', 'Discord_memo')}\`

**対象チャンネル:**
${targetChannels.map(ch => `• #${ch}`).join('\n')}

**機能:**
- 音声文字起こし: ✅ 有効
- 記事自動要約: ✅ 有効
- 論文収集: ✅ 有効

**保存済みアイデア:**
- 総数: ${stats.total}件
- テキスト: ${stats.text}件
- 音声: ${stats.voice}件
- 記事: ${stats.article}件
- 論文: ${stats.paper}件
    `;
    
    await message.reply(debugInfo);
}

// テストコマンド
async function handleTestCommand(message: Message) {
    try {
        const testResult = await transcriptionService.testAPI();
        if (testResult) {
            await message.reply('✅ Gemini API テスト成功！音声文字起こし機能が利用可能です。');
        } else {
            await message.reply('❌ Gemini API テスト失敗。API Keyを確認してください。');
        }
    } catch (error) {
        await message.reply('❌ テスト中にエラーが発生しました。');
    }
}

// ヘルプコマンド
async function handleHelpCommand(message: Message) {
    const helpText = `
🤖 **Voice Transcriber Bot - ヘルプ**

**基本機能:**
- 対象チャンネルでの投稿を自動的に番号付けして保存
- 音声ファイルは自動で文字起こし（Gemini API使用）
- URLは自動で記事を取得・要約
- arXivから論文を検索・要約

**コマンド:**
- \`!list\` または \`!リスト\` - 最近10件のアイデア一覧
- \`!list [チャンネル名]\` - 特定チャンネルのアイデア一覧
- \`!stats\` または \`!統計\` - アイデアの統計情報
- \`!paper\` または \`!論文\` - 論文検索機能
- \`!help\` または \`!ヘルプ\` - このヘルプを表示
- \`!debug\` または \`!デバッグ\` - デバッグ情報を表示
- \`!test\` または \`!テスト\` - Gemini APIのテスト

**対象チャンネル:**
${targetChannels.map(ch => `• #${ch}`).join('\n')}

**音声文字起こし:**
- 対応形式: .ogg, .mp3, .wav, .m4a
- 自動で日本語に文字起こし

**記事自動要約:**
- URLを含むメッセージを投稿すると自動で要約
- 記事のタイトル、著者、投稿日なども保存
- 要約と共にObsidianに保存

**論文収集:**
- \`!論文\` - メニューから選択
- \`!論文 [番号]\` - カテゴリーから検索
- \`!論文 [キーワード]\` - 自由検索
- \`!paper select [番号]\` - 論文を選択（複数可）
    `;
    
    await message.reply(helpText);
}

// エラーハンドリング
client.on('error', (error) => {
    console.error('❌ エラーが発生しました:', error);
});

// Botをログイン
client.login(process.env.DISCORD_TOKEN);