import { Client, GatewayIntentBits, Message, Attachment, PartialMessage, EmbedBuilder, TextChannel } from 'discord.js';
import dotenv from 'dotenv';
import { IdeaManager } from './services/ideaManager';
import { TranscriptionService } from './services/transcription';
import { ArticleScraper } from './services/articleScraper';
import { ArticleSummarizer } from './services/articleSummarizer';
import { ArxivService } from './services/arxivService';
import { PaperSummarizer } from './services/paperSummarizer';
import { MidjourneyService } from './services/midjourneyService';
import { GoogleDriveService } from './services/googleDriveService';
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

// 定数
const OBSIDIAN_VAULT_CHANNEL_NAME = 'obsidian-vault';
const MONITORED_CHANNELS = [
  '執筆アイデア',
  'aiアイデア',
  'プロンプトアイデア',
  'devアイデア',
  'ひらめき',
  'discord-develop',
  'meeting',
  '論文収集'
];

// Midjourney用のデータ保存
const imagePromptData = new Map<string, {
  imageUrl?: string;
  prompt?: string;
  replyMessageId: string;
  type: 'image' | 'audio';
  timestamp: number;
}>();

// 各サービスを初期化
const ideaManager = new IdeaManager();
const transcriptionService = new TranscriptionService();
const articleScraper = new ArticleScraper();
const articleSummarizer = new ArticleSummarizer(process.env.GOOGLE_AI_API_KEY!);
const arxivService = new ArxivService();
const paperSummarizer = new PaperSummarizer(process.env.GOOGLE_AI_API_KEY!);
const midjourneyService = new MidjourneyService(process.env.GOOGLE_AI_API_KEY!);
const googleDriveService = new GoogleDriveService();

// 論文検索用の一時保存
let lastPaperSearch: { channelId: string; papers: any[] } | null = null;

// Discord Clientを初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// 日時フォーマット関数
function formatDateTimeForDisplay(timestamp: string): string {
  const year = timestamp.slice(0, 4);
  const month = timestamp.slice(4, 6);
  const day = timestamp.slice(6, 8);
  const hour = timestamp.slice(9, 11);
  const minute = timestamp.slice(11, 13);
  const second = timestamp.slice(13, 15);
  
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

// Obsidian Vault チャンネルを取得する関数
async function getObsidianVaultChannel(guild: any) {
  let channel = guild.channels.cache.find((ch: any) => ch.name === OBSIDIAN_VAULT_CHANNEL_NAME);
  
  if (!channel) {
    channel = await guild.channels.create({
      name: OBSIDIAN_VAULT_CHANNEL_NAME,
      type: 0,
      topic: 'Obsidian同期用のMarkdownデータ保管庫'
    });
  }
  
  return channel;
}

// Obsidian形式のMarkdownを生成する関数
function generateObsidianMarkdown(idea: any, additionalInfo?: any): string {
  const timestamp = idea.createdAt?.toISOString() || new Date().toISOString();
  const dateTime = timestamp.includes('_') ? formatDateTimeForDisplay(timestamp) : timestamp;
  
  let markdown = `## 🗓️ ${dateTime}\n`;
  markdown += `**📍 チャンネル**: #${idea.channel}\n`;
  markdown += `**👤 投稿者**: ${idea.author || 'unknown'}\n`;
  
  switch (idea.type) {
    case 'voice':
      markdown += `**🎙️ タイプ**: 音声メモ`;
      if (idea.metadata?.duration) {
        markdown += ` (${idea.metadata.duration})`;
      }
      markdown += `\n\n### 💭 内容\n${idea.content}\n`;
      break;
      
    case 'article':
      markdown += `**📰 タイプ**: 記事要約\n`;
      if (idea.metadata?.url) {
        markdown += `**🔗 URL**: ${idea.metadata.url}\n`;
      }
      if (idea.metadata?.title) {
        markdown += `**📌 タイトル**: ${idea.metadata.title}\n`;
      }
      markdown += `\n### 📊 要約\n${idea.content}\n`;
      break;
      
    case 'paper':
      markdown += `**📄 タイプ**: 論文要約\n`;
      if (idea.metadata?.title) {
        markdown += `\n### 📑 論文情報\n`;
        markdown += `**タイトル**: ${idea.metadata.title}\n`;
        if (idea.metadata?.authors) {
          markdown += `**著者**: ${idea.metadata.authors}\n`;
        }
        if (idea.metadata?.category) {
          markdown += `**カテゴリ**: ${idea.metadata.category}\n`;
        }
      }
      markdown += `\n### 📊 要約\n${idea.content}\n`;
      
      if (additionalInfo?.detailedSummary) {
        markdown += `\n### 🔍 詳細な要約\n${additionalInfo.detailedSummary}\n`;
      }
      break;
      
    default:
      markdown += `**📝 タイプ**: テキストメモ\n\n### 💭 内容\n${idea.content}\n`;
  }
  
  if (idea.tags && idea.tags.length > 0) {
    markdown += `\n### 🏷️ タグ\n${idea.tags.map((tag: string) => `#${tag}`).join(' ')}\n`;
  }
  
  markdown += `\n---\n*↑このままObsidianにコピペ可能*`;
  
  return markdown;
}

// タイムスタンプ生成関数
function generateTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}${month}${day}_${hour}${minute}${second}`;
}

// Botが起動したとき
client.on('ready', () => {
  console.log(`✅ ${client.user?.tag} が起動しました！`);
  console.log(`📝 監視中のチャンネル: ${MONITORED_CHANNELS.join(', ')}`);
  console.log('🌐 記事自動要約機能: 有効');
  console.log('📚 論文収集機能: 有効');
  console.log('🎨 Midjourney連携: 有効');
  
  // 環境変数の確認
  console.log('\n🔧 環境変数の確認:');
  console.log(`📱 DISCORD_TOKEN: ${process.env.DISCORD_TOKEN ? '✅ 設定済み' : '❌ 未設定'}`);
  console.log(`🤖 GOOGLE_AI_API_KEY: ${process.env.GOOGLE_AI_API_KEY ? '✅ 設定済み' : '❌ 未設定'}`);
  console.log(`🎨 MIDJOURNEY_SREF_URL: ${process.env.MIDJOURNEY_SREF_URL ? '✅ 設定済み' : '❌ 未設定'}`);
  if (process.env.MIDJOURNEY_SREF_URL) {
    console.log(`   📎 スタイルリファレンスURL: ${process.env.MIDJOURNEY_SREF_URL}`);
  }
  console.log(`📁 OBSIDIAN_VAULT_PATH: ${process.env.OBSIDIAN_VAULT_PATH || 'デフォルト値使用'}`);
  console.log(`🌐 PORT: ${process.env.PORT || '3000'}`);
  
  // Google Drive設定確認
  const driveConfig = googleDriveService.checkConfiguration();
  console.log(`📁 Google Drive: ${driveConfig.configured ? '✅ 設定済み' : '❌ 未設定'}`);
  if (!driveConfig.configured) {
    console.log(`   ⚠️ ${driveConfig.message}`);
  }
});

// メッセージを受信したとき
client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) {
    // Midjourneyボットからのアップスケール画像を処理
    if (message.author.username === 'Midjourney Bot' && message.attachments.size > 0) {
      await handleMidjourneyUpscaleImage(message);
    }
    return;
  }
  if (!message.guild) return;
  
  const channelName = (message.channel as TextChannel).name;
  
  // ============================================
  // midjourneyチャンネル専用の処理
  // ============================================
  if (channelName === 'midjourney') {
    // 画像が添付されている場合
    const imageAttachment = message.attachments.find(att => 
      att.contentType?.startsWith('image')
    );
    
    if (imageAttachment) {
      await handleMidjourneyImage(message, imageAttachment);
      return;
    }
    
    // 音声が添付されている場合
    const audioExtensions = ['.ogg', '.mp3', '.wav', '.m4a'];
    const audioAttachment = message.attachments.find(att => 
      audioExtensions.some(ext => att.name?.toLowerCase().endsWith(ext))
    );
    
    if (audioAttachment) {
      await handleMidjourneyAudio(message, audioAttachment);
      return;
    }
    
    // 番号選択の処理
    if (/^[1-4]$/.test(message.content.trim())) {
      await handleAspectRatioSelection(message);
      return;
    }
    
    // それ以外は通常のチャット
    return;
  }
  
  // ============================================
  // 他のチャンネルでの既存の処理
  // ============================================
  
  // コマンド処理
  if (message.content.startsWith('!')) {
    await handleCommand(message);
    return;
  }
  
  // 監視対象チャンネルでのみ自動処理
  if (!MONITORED_CHANNELS.includes(channelName)) return;

  try {
    // 音声ファイルの処理
    if (message.attachments.size > 0) {
      await handleAttachments(message);
      return;
    }

    // URLを含むメッセージの処理
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.content.match(urlRegex);
    if (urls && urls.length > 0) {
      await handleArticleURL(message, urls[0]);
      return;
    }

    // 通常のテキストメッセージ
    if (message.content.trim()) {
      await handleTextMessage(message);
    }

  } catch (error) {
    console.error('エラー:', error);
    await message.reply('❌ 処理中にエラーが発生しました');
  }
});

// ============================================
// Midjourneyチャンネル専用：画像処理
// ============================================
async function handleMidjourneyImage(message: Message, imageAttachment: Attachment) {
  // アスペクト比選択を表示
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🎨 アスペクト比を選択してください')
    .setDescription(
      '**番号を入力してください：**\n\n' +
      '**1️⃣** → 16:9（横長）🖼️\n' +
      '**2️⃣** → 1:1（正方形）⬜\n' +
      '**3️⃣** → 9:16（縦長）📱\n' +
      '**4️⃣** → 4:5（ポートレート）🖼️'
    )
    .setImage(imageAttachment.url)
    .setFooter({ text: '番号を入力してください（1-4）' });

  const reply = await message.reply({ embeds: [embed] });
  
  // ユーザーの選択を保存
  imagePromptData.set(message.author.id, {
    imageUrl: imageAttachment.url,
    replyMessageId: reply.id,
    type: 'image',
    timestamp: Date.now()
  });
  
  // 30秒後にタイムアウト
  setTimeout(() => {
    if (imagePromptData.has(message.author.id)) {
      imagePromptData.delete(message.author.id);
      reply.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('⏰ タイムアウト')
            .setDescription('時間切れです。もう一度画像を投稿してください。')
        ]
      }).catch(() => {});
    }
  }, 30000);
}

// ============================================
// Midjourneyチャンネル専用：音声処理
// ============================================
async function handleMidjourneyAudio(message: Message, audioAttachment: Attachment) {
  const processingEmbed = new EmbedBuilder()
    .setColor(0xFFFF00)
    .setTitle('🎙️ 音声を処理中...')
    .setDescription('文字起こし中...')
    .setFooter({ text: 'しばらくお待ちください' });
  
  const reply = await message.reply({ embeds: [processingEmbed] });
  
  try {
    // 音声を文字起こし（URLを直接渡す）
    const transcription = await transcriptionService.transcribeAudio(
      audioAttachment.url,
      audioAttachment.contentType || 'audio/ogg'
    );
    
    // プログレス更新
    processingEmbed
      .setDescription('✅ 文字起こし完了\n📝 英語プロンプトを生成中...')
      .addFields({
        name: '文字起こし内容',
        value: transcription.length > 200 
          ? transcription.substring(0, 200) + '...' 
          : transcription
      });
    await reply.edit({ embeds: [processingEmbed] });
    
    // 英語プロンプトを生成
    const creativePrompt = await midjourneyService.generateCreativePrompt(transcription);
    
    // アスペクト比選択を表示
    const selectEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎨 アスペクト比を選択してください')
      .setDescription(
        '**番号を入力してください：**\n\n' +
        '**1️⃣** → 16:9（横長）🖼️\n' +
        '**2️⃣** → 1:1（正方形）⬜\n' +
        '**3️⃣** → 9:16（縦長）📱\n' +
        '**4️⃣** → 4:5（ポートレート）🖼️'
      )
      .addFields({
        name: '📝 生成されたプロンプト',
        value: creativePrompt.length > 200
          ? creativePrompt.substring(0, 200) + '...'
          : creativePrompt
      })
      .setFooter({ text: '番号を入力してください（1-4）' });
    
    await reply.edit({ embeds: [selectEmbed] });
    
    // ユーザーの選択を保存
    imagePromptData.set(message.author.id, {
      prompt: creativePrompt,
      replyMessageId: reply.id,
      type: 'audio',
      timestamp: Date.now()
    });
    
    // 30秒後にタイムアウト
    setTimeout(() => {
      if (imagePromptData.has(message.author.id)) {
        imagePromptData.delete(message.author.id);
        reply.edit({
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF0000)
              .setTitle('⏰ タイムアウト')
              .setDescription('時間切れです。もう一度音声を投稿してください。')
          ]
        }).catch(() => {});
      }
    }, 30000);
    
  } catch (error) {
    console.error('音声処理エラー:', error);
    await reply.edit({ content: '❌ 音声の処理に失敗しました' });
  }
}

// ============================================
// アスペクト比選択の処理
// ============================================
async function handleAspectRatioSelection(message: Message) {
  const data = imagePromptData.get(message.author.id);
  if (!data) return; // データがない場合は無視
  
  const selection = message.content.trim();
  const ratioMap: { [key: string]: string } = {
    '1': '16:9',
    '2': '1:1',
    '3': '9:16',
    '4': '4:5'
  };
  
  const aspectRatio = ratioMap[selection];
  if (!aspectRatio) return;
  
  // 元のメッセージを取得
  const replyMessage = await message.channel.messages.fetch(data.replyMessageId);
  
  try {
    // プロンプトを生成
    let prompt = '';
    
    if (data.type === 'image' && data.imageUrl) {
      // 画像の場合 - 元の内容を保持してスタイルのみ適用
      prompt = `${data.imageUrl}`;
    } else if (data.type === 'audio' && data.prompt) {
      // 音声の場合
      prompt = data.prompt;
    }
    
    // スタイルリファレンスがある場合は追加
    if (process.env.MIDJOURNEY_SREF_URL) {
      prompt += ` --sref ${process.env.MIDJOURNEY_SREF_URL} --sw 200`;
      console.log(`🎨 スタイルリファレンスを追加: ${process.env.MIDJOURNEY_SREF_URL}`);
    } else {
      console.log('⚠️ MIDJOURNEY_SREF_URLが設定されていません');
    }
    
    // 画像の場合は画像リファレンスの重みを強化
    if (data.type === 'image' && data.imageUrl) {
      prompt += ` --iw 3.0`;
      console.log(`🖼️ 画像リファレンスの重みを追加: --iw 3.0`);
    }
    
    // 選択されたアスペクト比を追加
    prompt += ` --ar ${aspectRatio}`;
    
    console.log(`📝 生成されたプロンプト: ${prompt}`);
    
    // プロンプトを送信（コピーしやすい形式で）
    if (message.channel.type === 0) { // TextChannelの場合
      await (message.channel as TextChannel).send(prompt);
    }
    
    // 完了メッセージに更新
    const successEmbed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ プロンプト生成完了！')
      .setDescription(
        `**アスペクト比：${aspectRatio}**\n\n` +
        `**📱 スマホでの使い方：**\n\n` +
        `1️⃣ 下のメッセージを**長押し**\n` +
        `2️⃣ **「コピー」**をタップ\n` +
        `3️⃣ Midjourneyに**貼り付け**\n` +
        `4️⃣ **送信！**`
      );
      
    if (data.imageUrl) {
      successEmbed.setImage(data.imageUrl);
    }
    
    await replyMessage.edit({ embeds: [successEmbed] });
    
    // 選択メッセージを削除（クリーンに保つ）
    await message.delete().catch(() => {});
    
  } catch (error) {
    console.error('エラー:', error);
    await replyMessage.edit({ content: '❌ エラーが発生しました' });
  }
  
  // データをクリーンアップ
  imagePromptData.delete(message.author.id);
}

// コマンド処理
async function handleCommand(message: Message) {
  const command = message.content.slice(1).split(' ')[0].toLowerCase();
  const args = message.content.slice(1).split(' ').slice(1);

  switch (command) {
    case 'test':
    case 'テスト':
      await testGeminiAPI(message);
      break;
    case '論文':
    case 'paper':
      await handlePaperCommand(message, args);
      break;
    case 'help':
    case 'ヘルプ':
      await showHelp(message);
      break;
    case 'stats':
    case '統計':
      await showStats(message);
      break;
    case 'list':
    case 'リスト':
      await showRecentIdeas(message, args[0]);
      break;
    default:
      await message.reply('❓ 不明なコマンドです。`!help`でコマンド一覧を確認してください。');
  }
}

// 音声ファイル処理
async function handleAttachments(message: Message) {
  const audioExtensions = ['.ogg', '.mp3', '.wav', '.m4a'];
  
  for (const attachment of message.attachments.values()) {
    const isAudio = audioExtensions.some(ext => attachment.name?.toLowerCase().endsWith(ext));
    
    if (isAudio) {
      const reply = await message.reply('🎙️ 音声を文字起こし中...');
      
      try {
        // 音声を文字起こし（URLを直接渡す）
        const transcription = await transcriptionService.transcribeAudio(
          attachment.url,
          attachment.contentType || 'audio/ogg'
        );
        
        const idea = await ideaManager.addIdea(
          (message.channel as TextChannel).name,
          transcription,
          'voice'
        );
        
        // 一時的なデータオブジェクトを作成してObsidian形式を生成
        const tempIdea = {
          timestamp: generateTimestamp(),
          content: transcription,
          type: 'voice',
          author: message.author.username,
          channel: (message.channel as TextChannel).name,
          tags: [],
          metadata: { 
            fileName: attachment.name,
            duration: attachment.size ? `${Math.round(attachment.size / 1000)}KB` : undefined
          }
        };
        
        // Obsidian Vault チャンネルに投稿
        const vaultChannel = await getObsidianVaultChannel(message.guild!);
        const obsidianMarkdown = generateObsidianMarkdown(tempIdea);
        await vaultChannel.send(`\`\`\`markdown\n${obsidianMarkdown}\n\`\`\``);
        
        await reply.edit(`✅ 音声の文字起こしが完了しました！\n📅 アイデア ID: ${idea.id}`);
        
      } catch (error) {
        console.error('音声処理エラー:', error);
        await reply.edit('❌ 音声の文字起こしに失敗しました');
      }
    }
  }
}

// 記事URL処理
async function handleArticleURL(message: Message, url: string) {
  const processingMsg = await message.reply('📰 記事を取得中...');
  
  try {
    const article = await articleScraper.scrapeArticle(url);
    const summary = await articleSummarizer.summarizeArticle(article);
    
    const idea = await ideaManager.addArticleIdea(
      (message.channel as TextChannel).name,
      url,
      article,
      summary,
      []
    );
    
    // 一時的なデータオブジェクトを作成してObsidian形式を生成
    const tempIdea = {
      timestamp: generateTimestamp(),
      content: summary,
      type: 'article',
      author: message.author.username,
      channel: (message.channel as TextChannel).name,
      tags: [],
      metadata: {
        url: url,
        title: article.title,
        author: article.author,
        publishedDate: article.publishedDate
      }
    };
    
    // Obsidian Vault チャンネルに投稿
    const vaultChannel = await getObsidianVaultChannel(message.guild!);
    const obsidianMarkdown = generateObsidianMarkdown(tempIdea);
    await vaultChannel.send(`\`\`\`markdown\n${obsidianMarkdown}\n\`\`\``);
    
    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle(article.title || '記事')
      .setURL(url)
      .setDescription(summary)
      .setFooter({ text: `保存済み | アイデア ID: ${idea.id}` });
    
    await processingMsg.edit({ content: '✅ 記事を要約しました！', embeds: [embed] });
    
  } catch (error) {
    console.error('記事処理エラー:', error);
    await processingMsg.edit('❌ 記事の取得または要約に失敗しました');
  }
}

// テキストメッセージ処理
async function handleTextMessage(message: Message) {
  const idea = await ideaManager.addIdea(
    (message.channel as TextChannel).name,
    message.content,
    'text'
  );
  
  // 一時的なデータオブジェクトを作成してObsidian形式を生成
  const tempIdea = {
    timestamp: generateTimestamp(),
    content: message.content,
    type: 'text',
    author: message.author.username,
    channel: (message.channel as TextChannel).name,
    tags: []
  };
  
  // Obsidian Vault チャンネルに投稿
  const vaultChannel = await getObsidianVaultChannel(message.guild!);
  const obsidianMarkdown = generateObsidianMarkdown(tempIdea);
  await vaultChannel.send(`\`\`\`markdown\n${obsidianMarkdown}\n\`\`\``);
  
  await message.reply(`💡 アイデアを保存しました！\n📅 アイデア ID: ${idea.id}`);
}

// 論文コマンド処理
async function handlePaperCommand(message: Message, args: string[]) {
  if (args.length === 0) {
    await showPaperMenu(message);
  } else if (args[0] === 'select') {
    await selectPapers(message, args.slice(1));
  } else {
    const query = args.join(' ');
    await searchPapers(message, query);
  }
}

// 論文メニュー表示
async function showPaperMenu(message: Message) {
  const embed = new EmbedBuilder()
    .setColor(0x00AE86)
    .setTitle('📚 論文検索メニュー')
    .setDescription('検索したいカテゴリーの番号を入力してください')
    .addFields(
      { name: '1. AI・機械学習', value: '最新のAI・ML研究', inline: true },
      { name: '2. 自然言語処理', value: 'NLP・言語モデル', inline: true },
      { name: '3. コンピュータビジョン', value: '画像認識・生成', inline: true },
      { name: '4. ロボティクス', value: 'ロボット工学', inline: true },
      { name: '5. 量子コンピュータ', value: '量子計算・量子情報', inline: true },
      { name: '6. 医療・ヘルスケアAI', value: '医療AI応用', inline: true },
      { name: '7. 建設・建築技術', value: '建設技術・BIM', inline: true },
      { name: '8. 自動運転', value: '自動運転技術', inline: true },
      { name: '9. セキュリティ・暗号', value: '情報セキュリティ', inline: true }
    )
    .addFields({
      name: '💡 使い方',
      value: '`!論文 1` のように番号を入力\n`!論文 AIロボット` のように自由検索も可能'
    });
  
  await message.reply({ embeds: [embed] });
}

// 論文検索
async function searchPapers(message: Message, query: string) {
  const searchingMsg = await message.reply('🔍 論文を検索中...');
  
  try {
    const papers = await arxivService.searchPapers(query);
    
    if (papers.length === 0) {
      await searchingMsg.edit('📭 該当する論文が見つかりませんでした');
      return;
    }
    
    lastPaperSearch = {
      channelId: message.channel.id,
      papers: papers
    };
    
    let response = '📚 **論文検索結果**\n\n';
    papers.slice(0, 10).forEach((paper, index) => {
      response += `**${index + 1}.** ${paper.title}\n`;
      response += `   著者: ${paper.authors.slice(0, 3).join(', ')}${paper.authors.length > 3 ? ' 他' : ''}\n`;
      response += `   公開日: ${paper.published}\n\n`;
    });
    
    response += '\n📌 論文を選択: `!paper select 1,3,5` または `!paper select 1-3`';
    
    await searchingMsg.edit(response);
    
  } catch (error) {
    console.error('論文検索エラー:', error);
    await searchingMsg.edit('❌ 論文の検索に失敗しました');
  }
}

// 論文選択処理
async function selectPapers(message: Message, args: string[]) {
  if (!lastPaperSearch || lastPaperSearch.channelId !== message.channel.id) {
    await message.reply('❌ 先に論文を検索してください');
    return;
  }
  
  // ここでlastPaperSearchは確実に存在する
  const papers = lastPaperSearch.papers;
  
  const processingMsg = await message.reply('📝 論文を処理中...');
  const selectedIndices: number[] = [];
  
  // インデックスのパース
  for (const arg of args) {
    if (arg.includes('-')) {
      const [start, end] = arg.split('-').map(n => parseInt(n) - 1);
      for (let i = start; i <= end && i < papers.length; i++) {
        selectedIndices.push(i);
      }
    } else if (arg.includes(',')) {
      arg.split(',').forEach(n => {
        const index = parseInt(n) - 1;
        if (index >= 0 && index < papers.length) {
          selectedIndices.push(index);
        }
      });
    } else {
      const index = parseInt(arg) - 1;
      if (index >= 0 && index < papers.length) {
        selectedIndices.push(index);
      }
    }
  }
  
  if (selectedIndices.length === 0) {
    await processingMsg.edit('❌ 有効な番号を指定してください');
    return;
  }
  
  // 論文を処理
  const results = [];
  const vaultChannel = await getObsidianVaultChannel(message.guild!);
  
  for (const index of selectedIndices) {
    try {
      const paper = papers[index];
      const summary = await paperSummarizer.summarizePaper(paper);
      
      const idea = await ideaManager.addPaperIdea(
        {
          arxivId: paper.arxivId,
          title: paper.title,
          authors: paper.authors,
          publishedDate: paper.published.toISOString(),
          categories: paper.categories,
          pdfUrl: paper.pdfUrl,
          abstract: paper.abstract
        },
        summary
      );
      
      // 一時的なデータオブジェクトを作成してObsidian形式を生成
      const tempIdea = {
        timestamp: generateTimestamp(),
        content: summary.summary,
        type: 'paper',
        author: message.author.username,
        channel: (message.channel as TextChannel).name,
        tags: summary.tags || [],
        metadata: {
          title: paper.title,
          authors: paper.authors.join(', '),
          category: paper.categories.join(', '),
          arxivId: paper.id,
          url: paper.pdfUrl,
          abstract: paper.abstract
        }
      };
      
      // detailedSummaryが存在する場合のみ追加
      const additionalInfo = summary.keyFindings ? {
        detailedSummary: `**重要な発見:**\n${summary.keyFindings.join('\n')}\n\n**応用可能性:**\n${summary.applications}`
      } : undefined;
      
      const obsidianMarkdown = generateObsidianMarkdown(tempIdea, additionalInfo);
      await vaultChannel.send(`\`\`\`markdown\n${obsidianMarkdown}\n\`\`\``);
      
      results.push({
        success: true,
        timestamp: generateTimestamp(),
        title: paper.title.substring(0, 50) + '...'
      });
      
    } catch (error) {
      console.error(`論文処理エラー:`, error);
      results.push({ success: false });
    }
  }
  
  // 結果を表示
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  
  let resultMsg = `📊 **論文処理完了**\n✅ 成功: ${successCount}件 ❌ 失敗: ${failCount}件\n\n`;
  
  if (successCount > 0) {
    resultMsg += '**📚 保存された論文**\n';
    results.filter(r => r.success).forEach(r => {
      resultMsg += `**${formatDateTimeForDisplay(r.timestamp!)}** ${r.title}\n`;
    });
  }
  
  resultMsg += '\n✅ Obsidian Vaultチャンネルに保存されました';
  
  await processingMsg.edit(resultMsg);
}

// Gemini APIテスト
async function testGeminiAPI(message: Message) {
  try {
    const testPrompt = "こんにちは！テストです。";
    const response = await articleSummarizer.summarizeArticle({ 
      content: testPrompt, 
      title: 'Test',
      url: '',
      author: '',
      publishedDate: ''
    });
    await message.reply(`✅ Gemini API テスト成功: ${response}`);
  } catch (error) {
    console.error('Gemini APIテストエラー:', error);
    await message.reply('❌ Gemini API テスト失敗');
  }
}

// ヘルプ表示
async function showHelp(message: Message) {
  const embed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle('📖 ヘルプ')
    .setDescription('Voice Transcriber Botの使い方')
    .addFields(
      { name: '🎙️ 音声メモ', value: '音声ファイルを投稿すると自動で文字起こし' },
      { name: '💡 テキストメモ', value: '監視対象チャンネルに投稿すると自動保存' },
      { name: '📰 記事要約', value: 'URLを含むメッセージを投稿すると自動要約' },
      { name: '📚 論文検索', value: '`!論文` でメニュー表示\n`!論文 [検索語]` で検索' },
      { name: '📊 統計', value: '`!stats` で保存状況を確認' },
      { name: '📋 一覧', value: '`!list` で最近のアイデア一覧' },
      { name: '🧪 テスト', value: '`!test` でAPI動作確認' }
    )
    .addFields({
      name: '📁 保存先',
      value: '#obsidian-vault チャンネルに自動投稿'
    })
    .addFields({
      name: '🎨 Midjourney画像生成',
      value: '#midjourneyチャンネルに画像や音声を投稿すると\n自動でプロンプトを生成します'
    });
  
  await message.reply({ embeds: [embed] });
}

// 統計表示
async function showStats(message: Message) {
  const stats = ideaManager.getStats();
  const embed = new EmbedBuilder()
    .setColor(0x00D166)
    .setTitle('📊 統計情報')
    .addFields(
      { name: '💡 総アイデア数', value: stats.total.toString(), inline: true },
      { name: '🎙️ 音声メモ', value: stats.voice.toString(), inline: true },
      { name: '📝 テキスト', value: stats.text.toString(), inline: true },
      { name: '📰 記事', value: stats.article.toString(), inline: true },
      { name: '📚 論文', value: stats.paper.toString(), inline: true }
    );
  
  await message.reply({ embeds: [embed] });
}

// 最近のアイデア表示
async function showRecentIdeas(message: Message, channelFilter?: string) {
  const ideas = ideaManager.getRecentIdeas(10, channelFilter);
  
  if (ideas.length === 0) {
    await message.reply('📭 アイデアがまだありません');
    return;
  }
  
  let response = '📋 **最近のアイデア**\n\n';
  ideas.forEach((idea: any) => {
    const icon = idea.type === 'voice' ? '🎙️' : 
                 idea.type === 'article' ? '📰' : 
                 idea.type === 'paper' ? '📚' : '💡';
    const timestamp = idea.createdAt ? idea.createdAt.toISOString() : 'unknown';
    const channel = idea.channel || 'unknown';
    const content = idea.content || '';
    
    response += `${icon} **${idea.id}** - #${channel}\n`;
    response += `   ${content.substring(0, 50)}...\n\n`;
  });
  
  await message.reply(response);
}

// 古いデータのクリーンアップ（30分ごと）
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30分
  
  for (const [key, value] of imagePromptData.entries()) {
    if (now - value.timestamp > timeout) {
      imagePromptData.delete(key);
    }
  }
}, 30 * 60 * 1000);

// ============================================
// Midjourneyアップスケール画像の自動保存
// ============================================
async function handleMidjourneyUpscaleImage(message: Message) {
  try {
    // アップスケール画像かどうかを判定
    const isUpscaleImage = message.content.includes('Image #') || 
                          message.content.includes('Upscaled by') ||
                          (message.attachments.size > 0 && message.content.length < 100);
    
    if (!isUpscaleImage) return;

    console.log('🎨 Midjourneyアップスケール画像を検出しました');
    
    for (const attachment of message.attachments.values()) {
      if (attachment.contentType?.startsWith('image')) {
        try {
          // ファイル名を生成（メッセージ内容とタイムスタンプから）
          const promptInfo = message.content || 'midjourney_upscale';
          const fileName = googleDriveService.generateFileName(promptInfo, '1x1');
          
          // Google Driveにアップロード
          const driveUrl = await googleDriveService.uploadImageFromUrl(attachment.url, fileName);
          
          // 成功メッセージを送信
          const successEmbed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('📁 Google Drive保存完了！')
            .setDescription(`アップスケール画像を自動保存しました`)
            .addFields(
              { name: '📎 ファイル名', value: fileName },
              { name: '🔗 Google Drive', value: `[ファイルを開く](${driveUrl})` }
            )
            .setThumbnail(attachment.url)
            .setTimestamp();

          if (message.channel.type === 0) {
            await (message.channel as TextChannel).send({ embeds: [successEmbed] });
          }
          
        } catch (error) {
          console.error('❌ Google Drive保存エラー:', error);
          
          // エラーメッセージを送信
          const errorEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ 保存エラー')
            .setDescription('Google Driveへの保存に失敗しました')
            .addFields({ name: 'エラー', value: error instanceof Error ? error.message : 'Unknown error' })
            .setTimestamp();

          if (message.channel.type === 0) {
            await (message.channel as TextChannel).send({ embeds: [errorEmbed] });
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ アップスケール画像処理エラー:', error);
  }
}

// Botをログイン
client.login(process.env.DISCORD_TOKEN);