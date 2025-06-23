import * as fs from 'fs';
import * as path from 'path';
import { Idea, ArticleIdea, PaperIdea, AnyIdea } from './ideaManager';
import { ArxivPaper } from './arxivService';

export class ObsidianSync {
    private vaultPath: string;
    private basePath: string;

    constructor() {
        this.vaultPath = process.env.OBSIDIAN_VAULT_PATH || '';
        this.basePath = path.join(this.vaultPath, 'AI_MEMO', 'Discord_memo');
        
        console.log('🏗️ ObsidianSync初期化');
        console.log('📁 Vault Path:', this.vaultPath);
        console.log('📁 Base Path:', this.basePath);
        
        // 各チャンネル用のフォルダを作成
        this.setupChannelFolders();
    }

    // チャンネルごとのフォルダを作成
    private setupChannelFolders(): void {
        const channels = [
            '執筆アイデア',
            'aiアイデア', 
            'プロンプトアイデア',
            'devアイデア',
            'ひらめき',
            'discord-develop',
            'meeting',
            '論文収集'  // 追加
        ];

        channels.forEach(channel => {
            const channelPath = path.join(this.basePath, channel);
            this.ensureDirectoryExists(channelPath);
        });
    }

    // ディレクトリが存在することを確認（なければ作成）
    private ensureDirectoryExists(dirPath: string): void {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            console.log(`📁 フォルダを作成しました: ${dirPath}`);
        }
    }

    // 通常のアイデアをMarkdownファイルとして保存
    async saveIdeaToObsidian(idea: Idea): Promise<string> {
        console.log('🔍 saveIdeaToObsidian開始:', idea.channel);
        
        const date = new Date(idea.createdAt);
        const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
        const filename = `idea_${idea.id}_${dateStr}.md`;
        
        // チャンネル名のフォルダに保存
        const channelPath = path.join(this.basePath, idea.channel);
        const filePath = path.join(channelPath, filename);
        
        console.log('📂 保存先フォルダ:', channelPath);
        console.log('📄 保存ファイル:', filePath);

        // フォルダが存在するか確認
        if (!fs.existsSync(channelPath)) {
            console.log('⚠️ フォルダが存在しません。作成します:', channelPath);
            this.ensureDirectoryExists(channelPath);
        }

        // Markdownコンテンツを生成
        const markdownContent = this.generateMarkdown(idea);
        console.log('📝 Markdownコンテンツ生成完了');

        // ファイルを保存
        try {
            fs.writeFileSync(filePath, markdownContent, 'utf-8');
            console.log(`✅ Obsidianに保存しました: ${idea.channel}/${filename}`);
            return filePath;
        } catch (error) {
            console.error('❌ Obsidian保存エラー:', error);
            throw error;
        }
    }

    // 記事アイデアをMarkdownファイルとして保存
    async saveArticleToObsidian(idea: ArticleIdea): Promise<string> {
        console.log('🔍 saveArticleToObsidian開始:', idea.channel);
        
        const date = new Date(idea.createdAt);
        const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
        const filename = `article_${idea.id}_${dateStr}.md`;
        
        // チャンネル名のフォルダに保存
        const channelPath = path.join(this.basePath, idea.channel);
        const filePath = path.join(channelPath, filename);
        
        console.log('📂 保存先フォルダ:', channelPath);
        console.log('📄 保存ファイル:', filePath);

        // フォルダが存在するか確認
        if (!fs.existsSync(channelPath)) {
            console.log('⚠️ フォルダが存在しません。作成します:', channelPath);
            this.ensureDirectoryExists(channelPath);
        }

        // Markdownコンテンツを生成
        const markdownContent = this.generateArticleMarkdown(idea);
        console.log('📝 記事Markdownコンテンツ生成完了');

        // ファイルを保存
        try {
            fs.writeFileSync(filePath, markdownContent, 'utf-8');
            console.log(`✅ 記事をObsidianに保存しました: ${idea.channel}/${filename}`);
            return filePath;
        } catch (error) {
            console.error('❌ 記事のObsidian保存エラー:', error);
            throw error;
        }
    }

    // 論文をMarkdownファイルとして保存
    async savePaperToObsidian(
        paperData: {
            arxivId: string;
            title: string;
            authors: string[];
            publishedDate: string;
            categories: string[];
            pdfUrl: string;
            abstract: string;
        },
        summary: {
            summary: string;
            keyFindings: string[];
            applications: string;
            tags: string[];
        },
        ideaId: string
    ): Promise<string> {
        const date = new Date();
        const dateStr = date.toISOString().split('T')[0];
        const fileName = `paper_${ideaId}_${dateStr}.md`;
        const folderPath = path.join(this.basePath, '論文収集');
        
        // フォルダが存在しない場合は作成
        this.ensureDirectoryExists(folderPath);
        
        const filePath = path.join(folderPath, fileName);
        
        // フロントマター
        const frontmatter = `---
id: ${ideaId}
type: research_paper
source: arxiv
title: "${paperData.title.replace(/"/g, '\\"')}"
authors: ${JSON.stringify(paperData.authors)}
published: ${paperData.publishedDate}
arxiv_id: ${paperData.arxivId}
url: https://arxiv.org/abs/${paperData.arxivId}
pdf: ${paperData.pdfUrl}
categories: ${JSON.stringify(paperData.categories)}
collected: ${date.toISOString()}
tags: ${JSON.stringify(summary.tags)}
status: inbox
---`;

        // 本文
        const content = `
# ${paperData.title}

## 論文情報
- **著者**: ${paperData.authors.join(', ')}
- **発表日**: ${new Date(paperData.publishedDate).toLocaleDateString('ja-JP')}
- **arXiv ID**: [${paperData.arxivId}](https://arxiv.org/abs/${paperData.arxivId})
- **PDF**: [ダウンロード](${paperData.pdfUrl})
- **カテゴリ**: ${paperData.categories.join(', ')}

## 要約
${summary.summary}

## 重要な発見
${summary.keyFindings.map(finding => `- ${finding}`).join('\n')}

## 応用可能性
${summary.applications}

## Abstract (原文)
${paperData.abstract}

## 関連キーワード
${summary.tags.map(tag => `#${tag}`).join(' ')}

---
*このメモは Discord Bot により自動生成されました*
*論文ID: #${ideaId}*
*収集日時: ${date.toLocaleString('ja-JP')}*
`;

        const fullContent = frontmatter + '\n' + content;
        
        try {
            fs.writeFileSync(filePath, fullContent, 'utf-8');
            console.log(`✅ 論文をObsidianに保存しました: 論文収集/${fileName}`);
            return filePath;
        } catch (error) {
            console.error('❌ 論文のObsidian保存エラー:', error);
            throw error;
        }
    }

    // 通常のアイデア用Markdown形式でコンテンツを生成
    private generateMarkdown(idea: Idea): string {
        const date = new Date(idea.createdAt);
        const formattedDate = date.toLocaleString('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const frontmatter = `---
id: ${idea.id}
created: ${date.toISOString()}
channel: ${idea.channel}
type: ${idea.type}
tags: [${idea.tags.join(', ')}]
status: inbox
---`;

        const content = `
# アイデア #${idea.id}

${idea.content}

## メタ情報
- チャンネル: ${idea.channel}
- 投稿タイプ: ${idea.type === 'voice' ? '🎤 音声' : '💡 テキスト'}
- 投稿日時: ${formattedDate}
${idea.tags.length > 0 ? `- タグ: ${idea.tags.map(t => `#${t}`).join(' ')}` : ''}

---
*このメモは Discord Bot により自動生成されました*
`;

        return frontmatter + '\n' + content;
    }

    // 記事アイデア用Markdown形式でコンテンツを生成
    private generateArticleMarkdown(idea: ArticleIdea): string {
        const date = new Date(idea.createdAt);
        const formattedDate = date.toLocaleString('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const articleData = idea.articleData;
        
        // 投稿日をフォーマット
        let publishedDateStr = '';
        if (articleData.publishedDate) {
            const pubDate = new Date(articleData.publishedDate);
            publishedDateStr = pubDate.toLocaleString('ja-JP', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
        }

        const frontmatter = `---
id: ${idea.id}
created: ${date.toISOString()}
channel: ${idea.channel}
type: article
url: ${articleData.url}
title: "${articleData.title.replace(/"/g, '\\"')}"
${articleData.author ? `author: "${articleData.author}"` : ''}
${articleData.publishedDate ? `published: ${articleData.publishedDate}` : ''}
${articleData.siteName ? `site: "${articleData.siteName}"` : ''}
tags: [${idea.tags.join(', ')}]
status: inbox
---`;

        const content = `
# ${articleData.title}

## 記事情報
- **URL**: [${articleData.url}](${articleData.url})
- **サイト**: ${articleData.siteName || 'N/A'}
${articleData.author ? `- **著者**: ${articleData.author}` : ''}
${publishedDateStr ? `- **投稿日**: ${publishedDateStr}` : ''}
- **取得日時**: ${formattedDate}
${idea.tags.length > 0 ? `- **タグ**: ${idea.tags.map(t => `#${t}`).join(' ')}` : ''}

${articleData.ogImage ? `\n![記事画像](${articleData.ogImage})\n` : ''}

${articleData.description ? `## 概要\n${articleData.description}\n` : ''}

## 要約

${idea.content}

---
*このメモは Discord Bot により自動生成されました*
*記事ID: #${idea.id}*
`;

        return frontmatter + '\n' + content;
    }
}