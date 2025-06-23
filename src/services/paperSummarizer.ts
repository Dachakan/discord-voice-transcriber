import { GoogleGenerativeAI } from '@google/generative-ai';
import { ArxivPaper } from './arxivService';

export class PaperSummarizer {
    private genAI: GoogleGenerativeAI;
    private model: any;

    constructor(apiKey: string) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    }

    async summarizePaper(paper: ArxivPaper): Promise<{
        summary: string;
        keyFindings: string[];
        applications: string;
        tags: string[];
    }> {
        const prompt = `
以下の学術論文を日本語で分析し、要約してください。

タイトル: ${paper.title}
著者: ${paper.authors.join(', ')}
カテゴリー: ${paper.categories.join(', ')}
要旨: ${paper.abstract}

以下の形式で回答してください：

1. 要約（3-5文で研究の概要を説明）:
[ここに要約を記載]

2. 重要な発見・貢献（箇条書きで3-5個）:
- [発見1]
- [発見2]
- [発見3]

3. 実用的な応用可能性:
[応用可能性を記載]

4. 関連キーワード（5-8個、カンマ区切り）:
[キーワード1, キーワード2, ...]
`;

        try {
            const result = await this.model.generateContent(prompt);
            const response = result.response.text();
            
            // レスポンスを解析
            const sections = response.split(/\d+\.\s/);
            
            const summary = sections[1]?.split('\n')[0]?.trim() || '';
            
            const keyFindingsSection = sections[2] || '';
            const keyFindings = keyFindingsSection
                .split('\n')
                .filter((line: string) => line.trim().startsWith('-'))
                .map((line: string) => line.replace(/^-\s*/, '').trim())
                .filter((line: string) => line.length > 0);
            
            const applications = sections[3]?.split('\n')[0]?.trim() || '';
            
            const keywordsSection = sections[4] || '';
            const tags = keywordsSection
                .split(',')
                .map((tag: string) => tag.trim())
                .filter((tag: string) => tag.length > 0)
                .map((tag: string) => tag.replace(/[[\]]/g, ''));

            return {
                summary,
                keyFindings,
                applications,
                tags
            };
        } catch (error) {
            console.error('論文要約エラー:', error);
            throw new Error('論文の要約に失敗しました');
        }
    }

    // 日本語の検索要求を英語のarXiv検索クエリに変換
    async translateSearchQuery(japaneseQuery: string): Promise<string> {
        const prompt = `
以下の日本語の論文検索要求を、arXivで検索するための適切な英語キーワードに変換してください。
技術的な専門用語を使い、AND/OR演算子も適切に使用してください。

日本語の検索要求: "${japaneseQuery}"

回答は英語のキーワードのみを返してください。例：
- "AIに関する論文" → "artificial intelligence OR AI OR machine learning"
- "建設技術に関する論文" → "construction technology OR civil engineering OR building technology"
- "最新の自然言語処理" → "natural language processing AND (2023 OR 2024)"

英語キーワード:`;

        try {
            const result = await this.model.generateContent(prompt);
            return result.response.text().trim();
        } catch (error) {
            console.error('検索クエリ変換エラー:', error);
            throw new Error('検索キーワードの変換に失敗しました');
        }
    }
}