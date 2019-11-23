import * as fs from 'fs';
import fetch from 'node-fetch';
import { Font, loadSync } from 'opentype.js';
import * as sqlite from 'sqlite3';

const sqlite3 = sqlite.verbose();

type FontMutexType = [string, Promise<Font>];

class FontParser {
    // List of FontMutexType values as a key-value-tuple of font id to font loading promise
    private __fontMutexList = new Array<FontMutexType>();
    private __dbInitialized: Promise<void>;

    private __cache = new sqlite3.Database(':memory:', () => {
    });

    constructor() {
        this.__dbInitialized = this.__init();
    }

    /**
     * Initializes the cache database.
     * 
     * @returns a Promise resolving when all database objects are properly created.
     */
    private __init(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.__cache.serialize(() => {

                this.__cache.run(`
                    CREATE TABLE IF NOT EXISTS font (
                        id VARCHAR(16) NOT NULL,
                        name VARCHAR(40) NOT NULL,
                        CONSTRAINT pk_font PRIMARY KEY (id)
                    );
                `);
                this.__cache.run(`
                    CREATE TABLE IF NOT EXISTS glyph (
                        font_id VARCHAR(16) NOT NULL,
                        glyph_index INTEGER NOT NULL,
                        glyph_name VARCHAR(40) NOT NULL,
                        CONSTRAINT pk_glyph PRIMARY KEY (font_id, glyph_name),
                        CONSTRAINT fk_glyph_font FOREIGN KEY (font_id) REFERENCES font (id) ON DELETE CASCADE,
                        CONSTRAINT un_glyph_index UNIQUE (font_id, glyph_index)
                    );
                `);
                this.__cache.run(`
                    CREATE TABLE IF NOT EXISTS glyph_unicode (
                        font_id VARCHAR(16) NOT NULL,
                        glyph_name VARCHAR(40) NOT NULL,
                        unicode INTEGER NOT NULL,
                        CONSTRAINT pk_glyph_unicode PRIMARY KEY (font_id, glyph_name, unicode),
                        CONSTRAINT fk_glyph_unicode_glyph FOREIGN KEY (font_id, glyph_name) REFERENCES glyph (font_id, glyph_name) ON DELETE CASCADE
                    );
                `);
                this.__cache.run(`
                    PRAGMA foreign_keys = ON;
                `);
                this.__cache.run(`
                    CREATE VIEW IF NOT EXISTS unicode_to_glyph_name AS 
                    SELECT f.id font_id, g.glyph_name glyph_name, gu.unicode glyph_unicode
                    FROM font f 
                    INNER JOIN glyph g ON (f.id = g.font_id)
                    INNER JOIN glyph_unicode gu ON (g.font_id = gu.font_id AND g.glyph_name = gu.glyph_name);
                `, (error) => {
                    if (error) {
                        return reject(error);
                    }
                    return resolve();
                });
            });
        });
    }

    /**
     * Downloads the font identified by the given font id and extracts its meta data.
     * 
     * @param fontId the internal font id (usually 8 characters long as mentioned in css and its filename)
     * 
     * @returns a Promise resolving to the font meta data.
     */
    private __loadFont(fontId: string): Promise<Font> {
        const fontDownloadUrl = `http://www.fussball.de/export.fontface/-/format/woff/id/${fontId}/type/font`;
        let fontDownloadPath = `dist/test/${fontId}`;

        const result = new Promise<Font>(async (resolve, reject) => {
            //console.log(`[__loadFont] Starting to load font "${fontId}"...`);
            const writeStream = fs.createWriteStream(fontDownloadPath);
            const response = await fetch(fontDownloadUrl);
            response.body.pipe(writeStream);
            response.body.on("error", (err) => {
                //console.log(`[__loadFont] Error occured while writing font file for "${fontId}"!`);
                return reject(err);
            });
            writeStream.on("finish", () => {
                const font: Font = loadSync(fontDownloadPath);
                //console.log(`[__loadFont] Font file for "${fontId}" successfully loaded!`);
                fs.unlinkSync(fontDownloadPath);
                //console.log(`[__loadFont] Font file for "${fontId}" successfully deleted!`);
                return resolve(font);
            });
        })
            .then(async (font) => {
                let fontCached = await this.isFontCached(fontId);
                if (!fontCached) {
                    //console.log(`[__loadFont] Adding new font "${fontId}" to cache!`);
                    fontCached = await this.addFontToCache(fontId, font);
                }
                if (!fontCached) {
                    throw new Error(`[__loadFont] Font "${fontId}" could not be cached!`);
                }

                return font;
            });

        //console.log(`[__loadFont] Returning Promise for font loading: "${fontId}"`);

        return result;
    }

    /**
     * Downloads the font identified by the given fontId and converts it to its meta data representation.
     * 
     * @param fontId the internal font id (usually 8 characters long as mentioned in css and its filename)
     * 
     * @returns a Promise resolving to a Font instance which provides lots of meta data.
     */
    loadFont(fontId: string): Promise<Font> {
        const fontMutex = this.__fontMutexList.find((value) => {
            return value[0] === fontId;
        });

        let result;
        if (fontMutex) {
            //console.log(`[loadFont] Font with id "${fontId}" found in mutex list...`);
            result = fontMutex[1];
        } else {
            //console.log(`[loadFont] Font with id "${fontId}" not found in mutex list...`);
            result = this.__loadFont(fontId);
            //console.log(`[loadFont] New font loading promise initialized for font with id "${fontId}".`);
            this.__fontMutexList.push([fontId, result]);
        }

        return result;
    }

    /**
     * Converts the given name of a glyph to a numeric value or throws an error if the name has no numeric representation.
     * 
     * @param name the name of the glyph 
     * 
     * @returns the numeric value representing the name string.
     */
    convertGlyphNameToNumber(name: string): number {
        switch (name) {
            case 'zero':
                return 0;
            case 'one':
                return 1;
            case 'two':
                return 2;
            case 'three':
                return 3;
            case 'four':
                return 4;
            case 'five':
                return 5;
            case 'six':
                return 6;
            case 'seven':
                return 7;
            case 'eight':
                return 8;
            case 'nine':
                return 9;
            default:
                throw new Error(`Glyph name "${name}" is not supported for conversion!`);
        }
    }

    /**
     * Checks, wheather the given fontId has been cached previously.
     * 
     * @param fontId the internal font id (usually 8 characters long as mentioned in css and its filename)
     * 
     * @returns a Promise resolving to the actual digit
     */
    isFontCached(fontId: string): Promise<boolean> {
        return new Promise(async (resolve, reject) => {
            await this.__dbInitialized;
            this.__cache.get(
                `SELECT 'x' FROM font WHERE lower(id) = lower(?)`,
                [fontId], (error, row) => {
                    if (error) {
                        return reject(error);
                    }
                    if (!row) {
                        return resolve(false);
                    }
                    return resolve(true);
                });
        });
    }

    /**
     * Adds the association between the glyph (identified by its name and the id of the font) and the numeric unicode value to the cache.
     *  
     * @param fontId the internal font id (usually 8 characters long as mentioned in css and its filename)
     * @param glyphName the name of the glyph as extracted from the font meta data (e.g. "four" or "two")
     * @param glyphUnicode the decimal representation of the unicode character 
     */
    private __cacheGlyphUnicode(fontId: string, glyphName: string, glyphUnicode: number): Promise<void> {
        const glyphUnicodeInsert = this.__cache.prepare(
            `INSERT INTO glyph_unicode (font_id, glyph_name, unicode) VALUES (?, ?, ?) ON CONFLICT DO NOTHING;`
        );
        return new Promise(async (resolve, reject) => {
            await this.__dbInitialized;
            glyphUnicodeInsert.run(fontId, glyphName, glyphUnicode, (error: Error) => {
                if (error) {
                    return reject(error);
                }
                //console.log(`[__cacheGlyphUnicode] Glyph unicode record for "${glyphName}" and unicode "${glyphUnicode}" inserted.`);
                return resolve();
            });
            glyphUnicodeInsert.finalize();
        });
    }

    /**
     * Adds the a glyph (identified by the providing font id, its index and name) to the cache.
     * 
     * @param fontId the internal font id (usually 8 characters long as mentioned in css and its filename)
     * @param glyphIndex the index of the glyph within its providing font metadata
     * @param glyphName the name of the glyph as extracted from the font meta data (e.g. "four" or "two")
     */
    private __cacheGlyph(fontId: string, glyphIndex: number, glyphName: string): Promise<void> {
        const glyphInsert = this.__cache.prepare(
            `INSERT INTO glyph (font_id, glyph_index, glyph_name) VALUES (?, ?, ?) ON CONFLICT DO NOTHING;`
        );
        return new Promise(async (resolve, reject) => {
            await this.__dbInitialized;
            glyphInsert.run(fontId, glyphIndex, glyphName, (error: Error) => {
                if (error) {
                    return reject(error);
                }
                //console.log(`[__cacheGlyph] Glyph record for "${glyphName}" inserted.`);
                return resolve();
            });
            glyphInsert.finalize();
        });
    }

    private __cacheFont(fontId: string, fontName: string): Promise<void> {
        const fontInsert = this.__cache.prepare(
            `INSERT INTO font (id, name) VALUES (?, ?) ON CONFLICT DO NOTHING;`,
        );
        return new Promise(async (resolve, reject) => {
            await this.__dbInitialized;
            fontInsert.run(fontId, fontName, (error: Error) => {
                if (error) {
                    return reject(error);
                }
                //console.log(`[__cacheFont] Font record for "${fontId}" inserted.`);
                return resolve();
            });
            fontInsert.finalize();
        });
    }

    /**
     * Adds the meta data of the referenced font to the cache database.
     * 
     * @param fontId the internal font id (usually 8 characters long as mentioned in css and its filename)
     * @param font the font instance to be cached
     * 
     * @returns a Promise resolving to a boolean success indicator
     */
    addFontToCache(fontId: string, font: Font): Promise<boolean> {
        //console.log(`[addFontToCache] Preparing db insertion...`);
        return new Promise(async (resolve, reject) => {
            try {
                await this.__cacheFont(fontId, 'n/a');

                for (let i = 0; i < font.glyphs.length; i++) {
                    const glyph = font.glyphs.get(i);
                    await this.__cacheGlyph(fontId, i, glyph.name);
                    for (let j = 0; j < glyph.unicodes.length; j++) {
                        await this.__cacheGlyphUnicode(fontId, glyph.name, glyph.unicodes[j]);
                    }
                }
                return resolve(true);

            } catch (ex) {
                //console.warn(`[addFontToCache] Failed to add font record for "${fontId}" to cache.`)
                return reject(ex);
            }
        });
    }

    /**
     * Fetches the numeric digit by querying the previously cached font meta data
     *  
     * @param fontId the internal font id (usually 8 characters long as mentioned in css and its filename)
     * @param unicode the unicode of the font specified by fontId
     * 
     * @returns a Promise resolving to the digit represented by the given parameters
     */
    queryGlyphByUnicode(fontId: string, unicode: number): Promise<number> {
        return new Promise((resolve, reject) => {
            this.__cache.get(`
                SELECT glyph_name FROM unicode_to_glyph_name WHERE font_id = ? AND glyph_unicode = ?;
            `, [fontId, unicode], (error, row) => {
                if (error) {
                    return reject(error);
                }
                if (!row) {
                    return reject(new Error(`No glyph with unicode ${unicode} found for font "${fontId}"!`));
                }
                const glyphName = row['glyph_name'];
                return resolve(this.convertGlyphNameToNumber(glyphName));
            });
        });
    }

    /**
     * Translates the given fontId and unicode to the actual digit.
     * 
     * @param fontId the internal font id (usually 8 characters long as mentioned in css and its filename)
     * @param unicode the unicode of the referenced glyph in decimal format 
     * 
     * @returns a Promise resolving to the actual digit 
     */
    translate(fontId: string, unicode: number): Promise<number> {
        return new Promise(async (resolve, reject) => {
            try {
                const result = await this.queryGlyphByUnicode(fontId, unicode);
                //console.log(`[translate] Returning result for font "${fontId}" and unicode ${unicode}: ${result}`);
                return resolve(result);
            } catch (ex) {
                return reject(ex);
            }

        });
    }

}

export { FontParser };
