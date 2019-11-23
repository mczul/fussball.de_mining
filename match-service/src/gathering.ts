import * as jsdom from 'jsdom';
import { Moment } from 'moment';
import { FontParser } from './deobfuscation';
import moment = require('moment');

interface Match {
    started: Date,
    home: {
        id: string,
        name: string,
        score: number,
    },
    guest: {
        id: string,
        name: string,
        score: number,
    }
}

class MatchListParser {
    private __unicodePrefixPattern = /^%u/;
    private __dateTimePattern = /^[a-z]{2},\s(?<date>[0-9]{2}\.[0-9]{2}\.[0-9]{2})\s\|\s(?<time>[0-9]{2}:[0-9]{2})$/i;
    private __teamUrlPattern = /^https?:\/\/www.fussball.de\/mannschaft\/(?<team_name>[^\/]+)\/-\/saison\/[0-9]{4}\/team-id\/(?<team_id>[0-9a-z]{32,})\/?$/i;
    private __fontParser: FontParser;

    constructor() {
        this.__fontParser = new FontParser();
    }

    private __parseScoreColumn(element: Element): Promise<number> {
        if (element) {
            const fontId = element.getAttribute('data-obfuscation');
            const glyphUnicode = escape(element.innerHTML).replace(this.__unicodePrefixPattern, '');
            if (fontId && glyphUnicode) {
                return this.__fontParser.loadFont(fontId)
                    .then(() => {
                        //console.log(`Font with id "${fontId}" loaded... parsing score element.`);
                        return this.__fontParser.translate(fontId, parseInt(glyphUnicode, 16));
                    });
            }
        }
        return Promise.reject(new Error(`FontId and / or glyph unicode could not be extracted!`));
    }

    parse(dom: jsdom.JSDOM): Promise<Array<Match>> {
        return new Promise(async (resolve, reject) => {
            // Start timestamps
            const startedValues = new Array<Date>();
            const startedColumns = dom.window.document.querySelectorAll('table>tbody>tr>td.column-date');
            startedColumns.forEach((startedColumn) => {
                let timestampString = '';
                if (startedColumn.textContent) {
                    const dateTimeMatch = this.__dateTimePattern.exec(startedColumn.textContent);
                    if (dateTimeMatch && dateTimeMatch.groups) {
                        timestampString = `${dateTimeMatch.groups.date} ${dateTimeMatch.groups.time}`;
                    } else {
                        return reject(new Error(`Match start timestamp string "${startedColumn.textContent}" did not match regular expression!`));
                    }
                    const startedDate = moment(timestampString, 'DD.MM.YY HH:mm').toDate();
                    startedValues.push(startedDate);
                } else {
                    return reject(new Error(`Match start timestamp not found!`));
                }
            });

            // Clubs
            const clubIds = new Array<string>();
            const clubNames = new Array<string>();
            const clubColumns = dom.window.document.querySelectorAll('table>tbody>tr>td.column-club');
            clubColumns.forEach((clubColumn) => {
                const clubLink = clubColumn.querySelector('a');
                if (!clubLink) {
                    return reject(new Error(`Club details link not found!`));
                }

                if (!clubLink.getAttribute('href')) {
                    return reject(new Error(`Club details link has no href!`));
                }

                const clubLinkUrl = clubLink.getAttribute('href') || '';
                const clubLinkMatch = this.__teamUrlPattern.exec(clubLinkUrl);
                if (!clubLinkMatch || !clubLinkMatch.groups) {
                    return reject(new Error(`Club details link url does not match the regular expression!`));
                }
                clubIds.push(clubLinkMatch.groups.team_id);

                const clubNameElement = clubLink.querySelector('div.club-name');
                if (!clubNameElement || !clubNameElement.innerHTML) {
                    return reject(new Error(`Club name info not found!`));
                }
                clubNames.push(clubNameElement.innerHTML.trim());
            });

            // Scores
            const scoreColumns = dom.window.document.querySelectorAll('table>tbody>tr>td.column-score');
            const scorePromises = { home: new Array<Promise<number>>(), guest: new Array<Promise<number>>() };
            scoreColumns.forEach(async (scoreColumn) => {
                const leftScore = scoreColumn.querySelector('span.score-left');
                if (leftScore) {
                    scorePromises.home.push(this.__parseScoreColumn(leftScore));
                }
                const rightScore = scoreColumn.querySelector('span.score-right');
                if (rightScore) {
                    scorePromises.guest.push(this.__parseScoreColumn(rightScore));
                }
            });

            try {
                const homeScores: Array<number> = await Promise.all(
                    scorePromises.home
                );
                const guestScores: Array<number> = await Promise.all(
                    scorePromises.guest
                );

                if (homeScores.length !== guestScores.length) {
                    return reject(new Error(`Fetched ${homeScores.length} home scores but ${guestScores.length} guest scores!`));
                }
                if (startedValues.length !== homeScores.length) {
                    return reject(new Error(`Fetched ${homeScores.length} scores but ${startedValues.length} matches!`));
                }
                if (startedValues.length !== clubNames.length / 2) {
                    return reject(new Error(`Fetched ${homeScores.length} scores but ${startedValues.length} matches!`));
                }

                const result = new Array<Match>();
                for (let i = 0; i < homeScores.length; i++) {
                    result.push({
                        started: startedValues[i],
                        home: {
                            id: clubIds[2 * i],
                            name: clubNames[2 * i],
                            score: homeScores[i]
                        },
                        guest: {
                            id: clubIds[2 * i + 1],
                            name: clubNames[2 * i + 1],
                            score: guestScores[i]
                        }
                    });
                }

                return resolve(result);
            } catch (ex) {
                return reject(ex);
            }
        });
    }


}

export { Match, MatchListParser }