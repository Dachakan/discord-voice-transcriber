import * as fs from 'fs';
import * as path from 'path';
import { ObsidianSync } from './obsidianSync';

// アイデアの基本型定義
export interface BaseIdea {
    id: string;          // 例: "001", "002"
    channel: string;     // チャンネル名
    content: string;     // 内容
    type: 'voice' | 'text' | 'article' | 'paper';  // タイプに paper を追加
    createdAt: Date;     // 作成日時
    tags: string[];      // タグ
    filePath?: string;   // 保存先パス
}

// 通常のアイデア
export interface Idea extends BaseIdea {
    type: 'voice' | 'text';
}

// 記事アイデア
export interface ArticleIdea extends BaseIdea {
    type: 'article';
    articleData: {
        url: string;
        title: string;
        author?: string;
        publishedDate?: string;
        siteName?: string;
        ogImage?: string;
        description?: string;
        summary: string;
    };
}

// 論文アイデア
export interface PaperIdea extends BaseIdea {
    type: 'paper';
    paperMetadata: {
        arxivId: string;
        authors: string[];
        publishedDate: string;
        categories: string[];
        pdfUrl: string;
        keyFindings?: string[];
        applications?: string;
    };
}

// 全てのアイデアの型
export type AnyIdea = Idea | ArticleIdea | PaperIdea;

// アイデアデータベースのパス
const DB_PATH = path.join(process.cwd(), 'data', 'ideas.json');

export class IdeaManager {
    private ideas: AnyIdea[] = [];
    private obsidianSync: ObsidianSync;

    constructor() {
        this.loadIdeas();
        this.obsidianSync = new ObsidianSync();
    }

    // アイデアを読み込み
    private loadIdeas(): void {
        try {
            // dataディレクトリが存在しない場合は作成
            const dataDir = path.join(process.cwd(), 'data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            if (fs.existsSync(DB_PATH)) {
                const data = fs.readFileSync(DB_PATH, 'utf-8');
                this.ideas = JSON.parse(data);
                console.log(`📂 ${this.ideas.length}件のアイデアを読み込みました`);
            } else {
                this.saveIdeas();
                console.log('📂 新しいアイデアデータベースを作成しました');
            }
        } catch (error) {
            console.error('❌ アイデアの読み込みに失敗:', error);
            this.ideas = [];
        }
    }

    // アイデアを保存
    private saveIdeas(): void {
        try {
            fs.writeFileSync(DB_PATH, JSON.stringify(this.ideas, null, 2));
        } catch (error) {
            console.error('❌ アイデアの保存に失敗:', error);
        }
    }

    // 次のID番号を取得
    private getNextId(): string {
        const lastIdea = this.ideas[this.ideas.length - 1];
        const nextNumber = lastIdea ? parseInt(lastIdea.id) + 1 : 1;
        return nextNumber.toString().padStart(3, '0');
    }

    // タグを抽出
    private extractTags(content: string): string[] {
        const tagPattern = /#[^\s#]+/g;
        const matches = content.match(tagPattern) || [];
        return matches.map(tag => tag.substring(1)); // #を除去
    }

    // 新しいアイデアを追加（音声・テキスト用）
    async addIdea(
        channel: string,
        content: string,
        type: 'voice' | 'text'
    ): Promise<Idea> {
        const id = this.getNextId();
        const tags = this.extractTags(content);
        
        const newIdea: Idea = {
            id,
            channel,
            content,
            type,
            createdAt: new Date(),
            tags
        };

        this.ideas.push(newIdea);
        this.saveIdeas();

        // Obsidianに保存
        try {
            console.log('📝 Obsidianに保存を開始します...');
            const filePath = await this.obsidianSync.saveIdeaToObsidian(newIdea);
            newIdea.filePath = filePath;
            this.saveIdeas(); // ファイルパスを更新
            console.log('✅ Obsidian保存完了:', filePath);
        } catch (error) {
            console.error('❌ Obsidian保存エラー:', error);
        }

        console.log(`✅ アイデア #${id} を保存しました`);
        return newIdea;
    }

    // 記事アイデアを追加
    async addArticleIdea(
        channel: string,
        url: string,
        articleData: any,
        summary: string,
        tags: string[]
    ): Promise<ArticleIdea> {
        const id = this.getNextId();
        
        // 記事の要約からもタグを抽出
        const summaryTags = this.extractTags(summary);
        const allTags = [...new Set([...tags, ...summaryTags])]; // 重複を除去
        
        const newIdea: ArticleIdea = {
            id,
            channel,
            content: summary,
            type: 'article',
            createdAt: new Date(),
            tags: allTags,
            articleData: {
                url,
                title: articleData.title,
                author: articleData.author,
                publishedDate: articleData.publishedDate,
                siteName: articleData.siteName,
                ogImage: articleData.ogImage,
                description: articleData.description,
                summary
            }
        };

        this.ideas.push(newIdea);
        this.saveIdeas();

        // Obsidianに保存
        try {
            console.log('📝 記事をObsidianに保存を開始します...');
            const filePath = await this.obsidianSync.saveArticleToObsidian(newIdea);
            newIdea.filePath = filePath;
            this.saveIdeas(); // ファイルパスを更新
            console.log('✅ 記事のObsidian保存完了:', filePath);
        } catch (error) {
            console.error('❌ 記事のObsidian保存エラー:', error);
        }

        console.log(`✅ 記事アイデア #${id} を保存しました`);
        return newIdea;
    }

    // 論文アイデアを追加
    async addPaperIdea(
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
        }
    ): Promise<PaperIdea> {
        const id = this.getNextId();
        
        const newIdea: PaperIdea = {
            id,
            channel: '論文収集',
            content: summary.summary,
            type: 'paper',
            createdAt: new Date(),
            tags: summary.tags,
            paperMetadata: {
                arxivId: paperData.arxivId,
                authors: paperData.authors,
                publishedDate: paperData.publishedDate,
                categories: paperData.categories,
                pdfUrl: paperData.pdfUrl,
                keyFindings: summary.keyFindings,
                applications: summary.applications
            }
        };

        this.ideas.push(newIdea);
        this.saveIdeas();

        // Obsidianに保存
        try {
            console.log('📝 論文をObsidianに保存を開始します...');
            const filePath = await this.obsidianSync.savePaperToObsidian(
                paperData,
                summary,
                newIdea.id
            );
            newIdea.filePath = filePath;
            this.saveIdeas(); // ファイルパスを更新
            console.log('✅ 論文のObsidian保存完了:', filePath);
        } catch (error) {
            console.error('❌ 論文のObsidian保存エラー:', error);
        }

        console.log(`✅ 論文アイデア #${id} を保存しました`);
        return newIdea;
    }

    // アイデアを更新
    async updateIdea(idea: AnyIdea): Promise<void> {
        const index = this.ideas.findIndex(i => i.id === idea.id);
        if (index !== -1) {
            this.ideas[index] = idea;
            this.saveIdeas();
        }
    }

    // 最近のアイデアを取得
    getRecentIdeas(limit: number = 10, channel?: string): AnyIdea[] {
        let filtered = [...this.ideas];
        
        if (channel) {
            filtered = filtered.filter(idea => idea.channel === channel);
        }

        return filtered
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, limit);
    }

    // IDでアイデアを検索
    getIdeaById(id: string): AnyIdea | undefined {
        return this.ideas.find(idea => idea.id === id);
    }

    // タイプ別の統計を取得
    getStats(): { total: number; voice: number; text: number; article: number; paper: number; byChannel: Record<string, number> } {
        const stats = {
            total: this.ideas.length,
            voice: 0,
            text: 0,
            article: 0,
            paper: 0,
            byChannel: {} as Record<string, number>
        };

        this.ideas.forEach(idea => {
            stats[idea.type]++;
            stats.byChannel[idea.channel] = (stats.byChannel[idea.channel] || 0) + 1;
        });

        return stats;
    }
}