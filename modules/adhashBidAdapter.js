import {registerBidder} from '../src/adapters/bidderFactory.js';
import { getStorageManager } from '../src/storageManager.js';
import {includes} from '../src/polyfill.js';
import {BANNER} from '../src/mediaTypes.js';

const VERSION = '3.0';
const BAD_WORD_STEP = 0.1;
const BAD_WORD_MIN = 0.2;
const ADHASH_BIDDER_CODE = 'adhash';

/**
 * Function that checks the page where the ads are being served for brand safety.
 * If unsafe words are found the scoring of that page increases.
 * If it becomes greater than the maximum allowed score false is returned.
 * The rules may vary based on the website language or the publisher.
 * The AdHash bidder will not bid on unsafe pages (according to 4A's).
 * @param badWords list of scoring rules to chech against
 * @param maxScore maximum allowed score for that bidding
 * @returns boolean flag is the page safe
 */
function brandSafety(badWords, maxScore) {
  /**
   * Performs the ROT13 encoding on the string argument and returns the resulting string.
   * The Adhash bidder uses ROT13 so that the response is not blocked by:
   *  - ad blocking software
   *  - parental control software
   *  - corporate firewalls
   * due to the bad words contained in the response.
   * @param value The input string.
   * @returns string Returns the ROT13 version of the given string.
   */
  const rot13 = value => {
    const input = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const output = 'NOPQRSTUVWXYZABCDEFGHIJKLMnopqrstuvwxyzabcdefghijklm';
    const index = x => input.indexOf(x);
    const translate = x => index(x) > -1 ? output[index(x)] : x;
    return value.split('').map(translate).join('');
  };

  /**
   * Calculates the scoring for each bad word with dimishing returns
   * @param {integer} points points that this word costs
   * @param {integer} occurances number of occurances
   * @returns {float} final score
   */
  const scoreCalculator = (points, occurances) => {
    let positive = true;
    if (points < 0) {
      points *= -1;
      positive = false;
    }
    let result = 0;
    for (let i = 0; i < occurances; i++) {
      result += Math.max(points - i * BAD_WORD_STEP, BAD_WORD_MIN);
    }
    return positive ? result : -result;
  };

  // Default parameters if the bidder is unable to send some of them
  badWords = badWords || [];
  maxScore = parseInt(maxScore) || 10;

  try {
    let score = 0;
    const content = window.top.document.body.innerText.toLowerCase();
    const words = content.trim().split(/\s+/).length;
    // Cyrillic unicode block range - 0400-04FF
    const cyrillicWords = content.match(/[\u0400-\u04FF]+/gi);
    for (const [word, rule, points] of badWords) {
      const decodedWord = rot13(word);
      if (
        (rule === 'full' && new RegExp('\\b' + decodedWord + '\\b', 'i').test(content)) ||
        (rule === 'full' && cyrillicWords && cyrillicWords.includes(decodedWord))
      ) {
        const occurances = cyrillicWords && cyrillicWords.includes(decodedWord)
          ? cyrillicWords.filter(word => word === decodedWord).length
          : content.match(new RegExp('\\b' + decodedWord + '\\b', 'g')).length;
        score += scoreCalculator(points, occurances);
      } else if (rule === 'partial' && content.indexOf(rot13(word.toLowerCase())) > -1) {
        const occurances = content.match(new RegExp(decodedWord, 'g')).length;
        score += scoreCalculator(points, occurances);
      } else if (
        (rule === 'starts' && new RegExp('\\b' + decodedWord, 'i').test(content)) ||
        (rule === 'starts' && cyrillicWords && cyrillicWords.some(word => word.startsWith(decodedWord)))
      ) {
        const occurances =
          cyrillicWords && cyrillicWords.some(word => word.startsWith(decodedWord))
            ? cyrillicWords.find(word => word.startsWith(decodedWord)).length
            : content.match(new RegExp('\\b' + decodedWord, 'g')).length;
        score += scoreCalculator(points, occurances);
      } else if (
        (rule === 'ends' && new RegExp(decodedWord + '\\b', 'i').test(content)) ||
        (rule === 'ends' && cyrillicWords && cyrillicWords.some(word => word.endsWith(decodedWord)))
      ) {
        const occurances =
          cyrillicWords && cyrillicWords.some(word => word.endsWith(decodedWord))
            ? cyrillicWords.find(word => word.endsWith(decodedWord)).length
            : content.match(new RegExp(decodedWord + '\\b', 'g')).length;
        score += scoreCalculator(points, occurances);
      } else if (rule === 'regexp' && new RegExp(decodedWord, 'i').test(content)) {
        const occurances = content.match(new RegExp(decodedWord, 'g')).length;
        score += scoreCalculator(points, occurances);
      }
    }
    return score < maxScore * words / 1000;
  } catch (e) {
    return true;
  }
}

export const spec = {
  code: ADHASH_BIDDER_CODE,
  supportedMediaTypes: [ BANNER ],

  isBidRequestValid: (bid) => {
    try {
      const { publisherId, platformURL } = bid.params;
      return (
        includes(Object.keys(bid.mediaTypes), BANNER) &&
        typeof publisherId === 'string' &&
        publisherId.length === 42 &&
        typeof platformURL === 'string' &&
        platformURL.length >= 13
      );
    } catch (error) {
      return false;
    }
  },

  buildRequests: (validBidRequests, bidderRequest) => {
    const storage = getStorageManager({ bidderCode: ADHASH_BIDDER_CODE });
    const { gdprConsent } = bidderRequest;
    const bidRequests = [];
    let referrer = '';
    try {
      referrer = window.top.location.href;
    } catch (e) {
      referrer = window.location.href;
    }
    for (var i = 0; i < validBidRequests.length; i++) {
      const bidderURL = validBidRequests[i].params.bidderURL || 'https://bidder.adhash.com';
      const url = `${bidderURL}/rtb?version=${VERSION}&prebid=true`;
      const index = Math.floor(Math.random() * validBidRequests[i].sizes.length);
      const size = validBidRequests[i].sizes[index].join('x');

      let recentAds = [];
      if (storage.localStorageIsEnabled()) {
        const prefix = validBidRequests[i].params.prefix || 'adHash';
        recentAds = JSON.parse(storage.getDataFromLocalStorage(prefix + 'recentAds') || '[]');
      }

      bidRequests.push({
        method: 'POST',
        url: url + '&publisher=' + validBidRequests[i].params.publisherId,
        bidRequest: validBidRequests[i],
        data: {
          timezone: new Date().getTimezoneOffset() / 60,
          location: referrer,
          publisherId: validBidRequests[i].params.publisherId,
          size: {
            screenWidth: window.screen.width,
            screenHeight: window.screen.height
          },
          navigator: {
            platform: window.navigator.platform,
            language: window.navigator.language,
            userAgent: window.navigator.userAgent
          },
          creatives: [{
            size: size,
            position: validBidRequests[i].adUnitCode
          }],
          blockedCreatives: [],
          currentTimestamp: (new Date().getTime() / 1000) | 0,
          recentAds: recentAds,
          GDPRApplies: gdprConsent ? gdprConsent.gdprApplies : null,
          GDPR: gdprConsent ? gdprConsent.consentString : null
        },
        options: {
          withCredentials: false,
          crossOrigin: true
        },
      });
    }
    return bidRequests;
  },

  interpretResponse: (serverResponse, request) => {
    const responseBody = serverResponse ? serverResponse.body : {};

    if (
      !responseBody.creatives ||
      responseBody.creatives.length === 0 ||
      !brandSafety(responseBody.badWords, responseBody.maxScore)
    ) {
      return [];
    }

    const publisherURL = JSON.stringify(request.bidRequest.params.platformURL);
    const bidderURL = request.bidRequest.params.bidderURL || 'https://bidder.adhash.com';
    const oneTimeId = request.bidRequest.adUnitCode + Math.random().toFixed(16).replace('0.', '.');
    const bidderResponse = JSON.stringify({ responseText: JSON.stringify(responseBody) });
    const requestData = JSON.stringify(request.data);

    return [{
      requestId: request.bidRequest.bidId,
      cpm: responseBody.creatives[0].costEUR,
      ad:
        `<div id="${oneTimeId}"></div>
        <script src="${bidderURL}/static/scripts/creative.min.js"></script>
        <script>callAdvertiser(${bidderResponse},['${oneTimeId}'],${requestData},${publisherURL})</script>`,
      width: request.bidRequest.sizes[0][0],
      height: request.bidRequest.sizes[0][1],
      creativeId: request.bidRequest.adUnitCode,
      netRevenue: true,
      currency: 'EUR',
      ttl: 60,
      meta: {
        advertiserDomains: responseBody.advertiserDomains ? [responseBody.advertiserDomains] : []
      }
    }];
  }
};

registerBidder(spec);
