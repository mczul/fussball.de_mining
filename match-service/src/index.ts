import express from 'express';
import morgan from 'morgan';
import * as jsdom from 'jsdom';
import fetch from 'node-fetch';
import * as process from 'process';
import { Match, MatchListParser } from './gathering';


/*
    TODOs:
        - Add missing comments in modules
        - Add support for scores with more than one digit
        - Add support for limited cache and mutex list in order to prevent OOM failures
        - Add tests, etc. 
*/

// Initialization of REST service
const port = 8080;
const host = '0.0.0.0';

const app = express();
app.use(morgan('combined'));


/**
 * 
 */
app.get('/api/v1/', (request, response) => {
    response.send('yehaaaa');
});

// Start of REST service 
app.listen(port, host, (error) => {
    if(error) {
        console.warn(error.message);
        process.exit(1);
    } 
    console.log(`Service now listening on ${host}:${port}.`);
});


const teamUrlPrefix = 'http://www.fussball.de/ajax.team.prev.games/-/mode/PAGE/team-id';
const teamIds = [
    '011MIFCKI8000000VTVG0001VTR8C1K7',
    '011MID3JL8000000VTVG0001VTR8C1K7',
    '011MIFFGFS000000VTVG0001VTR8C1K7',
    '0211K3QMT0000000VS548984VV2KG4QR',
    '01HFAUN8T0000000VV0AG80NVV0A1VPF',
    '011MIBAIFS000000VTVG0001VTR8C1K7',
    '011MIF5IA8000000VTVG0001VTR8C1K7',
    '026FPAR720000000VS5489B1VVJ2HPHR',
    '01ALGR39F4000000VV0AG80NVSQ9F5A9',
    '011MICFN6K000000VTVG0001VTR8C1K7',
    '011MIAFQTG000000VTVG0001VTR8C1K7',
];
const teamUrls = teamIds.map((id) => `${teamUrlPrefix}/${id}`);

const matchListParser = new MatchListParser();
const parserPromises: Array<Promise<Array<Match>>> = teamUrls.map((teamUrl) => {
    return fetch(teamUrl)
        .then((response) => {
            if (response.status !== 200) {
                throw new Error(`Failed to download team match list: "${teamUrl}"`);
            }
            return response.text();
        })
        .then((contentString) => {
            const matchListDom = new jsdom.JSDOM(contentString);
            return matchListParser.parse(matchListDom);
        });
});

Promise.all(parserPromises)
    .then((teamList) => {
        teamList.forEach((team) => {
            console.log(`Team successfully processed!`);
            console.log('#'.repeat(80));
            console.log(team);
            console.log('#'.repeat(80));
        });
    })
    .catch((error) => {
        console.log(error);
    });
