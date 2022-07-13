import adapter from '../src/AnalyticsAdapter.js';
import adapterManager from '../src/adapterManager.js';
import CONSTANTS from '../src/constants.json';
import { ajax } from '../src/ajax.js';
import { config } from '../src/config.js';

const analyticsType = 'endpoint';
const defaultUrl = '';
const VERSION = '3.0';
var auctionTracker = {};
var bidTimeouts = [];
var auctionEndStorage = null;
var platformURL;
var bidderAnalyticsDomain;
var publisherId;


const auctionInit = function (eventType, args) {

  var auctionId = args.auctionId;
  auctionTracker[auctionId] = {};
  //For each of the ad units, create the needed objects in auctionTracker
  args.adUnitCodes.forEach(
    adUnitId => auctionTracker[auctionId][adUnitId] = {
      req: {},
      res: {},
      nob: {}
    }
  );
}

const bidRequested = function(eventType, args) {
}

const bidResponse = function(eventType, args) {
}

const bidWon = function(eventType, args) {
  var relevantBidsData = [];
  var responses = auctionTracker[args.auctionId][args.adUnitCode].res;
  var nonResponses = auctionTracker[args.auctionId][args.adUnitCode].nob; 
  var bidResponders = Object.keys(responses);
  var noBidResponders = Object.keys(nonResponses);

  var bidResponsesRaw = auctionTracker[args.auctionId][args.adUnitCode].res
  var winningBid = {};
  var winningBidData = auctionEndStorage.bidsReceived.filter(
    bid => bid.bidderCode === args.bidderCode && bid.adUnitCode === args.adUnitCode
  )[0]

  winningBid.adTagId = args.adUnitCode;
  winningBid.bid = true;
  winningBid.language = window.navigator.language || '';
  winningBid.userAgent = window.navigator.userAgent || '';
  if (navigator.userAgentData && navigator.userAgentData.platform) {
    winningBid.platform = navigator.userAgentData.platform;
  } else {
    winningBid.platform = navigator.platform;
  }
  winningBid.timeZone = new Date().getTimezoneOffset() / 60,
    winningBid.width = winningBidData.width;
  winningBid.height = winningBidData.height;
  winningBid.screenWidth = screen.width;
  winningBid.screenHeight = screen.height;
  winningBid.size = `${winningBidData.width}x${winningBidData.height}`;
  winningBid.win = true;

  winningBid.cost = args.cpm / 1000;
  winningBid.currency = args.currency;
  winningBid.delay = args.timeToRespond;
  winningBid.pageURL = auctionTracker.pageURL;
  winningBid.ssp = args.bidder;

  relevantBidsData.push(winningBid);
  for (var bidder of bidResponders) {
    if (bidResponsesRaw[bidder].ssp !== winningBid.ssp) {
      relevantBidsData.push(bidResponsesRaw[bidder]);
    }
  }

  for (var bidder of noBidResponders) {
    relevantBidsData.push(nonResponses[bidder]);
  }

  //Send the JSON-stringified array to server
  var payload = JSON.stringify(relevantBidsData);
  var bidderPayload;
  var platformUrlMatch = platformURL.match(/.+(?=protocol\.php)/)
  var fullPlatformURL = (platformUrlMatch ? platformUrlMatch[0] : platformURL) + 'data.php?type=pbstats';

  ajax(fullPlatformURL, null, payload);
  if(bidderAnalyticsDomain && publisherId) {
    var optionalForwardSlash = bidderAnalyticsDomain.match(/\/$/) ? '' : '/';
    var bidderAnalyticsURL = `${bidderAnalyticsDomain}${optionalForwardSlash}protocol.php?action=prebid_impression&version=${VERSION}`
    
    bidderPayload = JSON.stringify(
      {
        platform: publisherId,
        data: relevantBidsData
      }
    );
    ajax(bidderAnalyticsURL, null, bidderPayload);
  }
}

const bidTimeout = function(eventType, args) {
  bidTimeouts = args;
}

const auctionEnd = function(eventType, args) {
  auctionEndStorage = args;
  //adding pageURL here:
  if (!auctionTracker.pageURL) {
    var firstRequest = args.bidderRequests[0];
    auctionTracker.pageURL = firstRequest.refererInfo.stack[firstRequest.refererInfo.stack.length - 1];
  }
  
  // Populate Request info
  args.bidderRequests.forEach(req => {
    for (var bid of req.bids) {
      auctionTracker[req.auctionId][bid.adUnitCode].req[req.bidderCode] = {
        ssp: req.bidderCode,
        pageURL: auctionTracker.pageURL,
        delay: null,
        bid: false,
        win: false,
        timeout: false,
        cost: null
      }
    }
  })

  // Populate Response info
  args.bidsReceived.forEach(res => {
      var unitAuction = auctionTracker[res.auctionId][res.adUnitCode];
      var reqObj = unitAuction.req;
      unitAuction.res[res.bidderCode] = {
          ssp: res.bidderCode,
          pageURL: reqObj[res.bidderCode].pageURL,
          delay: res.timeToRespond,
          bid: true,
          win: false,
          timeout: false,
          cost: res.cpm / 1000,
          currency: res.currency
      }
  })
  
  args.noBids.forEach(res => {
    var unitAuction = auctionTracker[res.auctionId][res.adUnitCode];
    
    var nobObj = unitAuction.nob;
    nobObj[res.bidder] = {
        ssp: res.bidder,
        pageURL: unitAuction.req[res.bidder].pageURL,
        delay: null,
        bid: false,
        win: false,
        timeout: false,
        cost: 0.0,
    }
  })
  
  bidTimeouts.forEach(req => {
    var unitAuction = auctionTracker[req.auctionId][req.adUnitCode];
      var noBidObject = unitAuction.nob;
      if(!noBidObject[req.bidder]) {
        noBidObject[req.bidder] = {
          ssp: req.bidder,
          pageURL: auctionTracker.pageURL,
          bid: false,
          win: false,
          timeout: true,
          cost: 0.0,
        }
      } else {
        // Do we want this to be true if it's already set, possibly by the explicit noBid event?
        noBidObject[req.bidder].timeout = true; 
      }
})
}

const noBid = function(eventType, args) {
  var auctionId = args.auctionId;
  var adUnitCode = args.adUnitCode;
  var bidder = args.bidder;
  auctionTracker[auctionId][adUnitCode].nob[bidder] = {
    bid: false,
    cost: 0,
    pageURL: auctionTracker.pageURL,
    ssp: bidder,
    timeout: false,
    win: false
  }

}



const {
  EVENTS: {
    AUCTION_INIT,
    BID_REQUESTED,
    BID_TIMEOUT,
    BID_RESPONSE,
    BID_WON,
    AUCTION_END,
    NO_BID
  }
} = CONSTANTS;

var adhashAdapter = Object.assign(adapter({ defaultUrl, analyticsType }), {
  track({ eventType, args }) {
    switch (eventType) {
      case AUCTION_INIT:
        auctionInit(eventType, args);
        break;
      case BID_REQUESTED:
        bidRequested(eventType, args);
        break;
      case BID_RESPONSE:
        bidResponse(eventType, args);
        break;
      case BID_WON:
        bidWon(eventType, args); //Send the data here.
        break;
      case BID_TIMEOUT:
        bidTimeout(eventType, args);
        break;
      case AUCTION_END:
        auctionEnd(eventType, args);
        break;
      case NO_BID:
        noBid(eventType, args);
        break;
      default:
        break;
    }
  }
});
adhashAdapter.context = {};

adhashAdapter.originEnableAnalytics = adhashAdapter.enableAnalytics;
adhashAdapter.enableAnalytics = (config) => {
  adhashAdapter.initOptions = config.options;
  platformURL = adhashAdapter.initOptions.platformURL;
  bidderAnalyticsDomain = adhashAdapter.initOptions.bidderURL;
  publisherId = adhashAdapter.initOptions.publisherId;

  adhashAdapter.originEnableAnalytics(config);
};

adapterManager.registerAnalyticsAdapter({
  adapter: adhashAdapter,
  code: 'adhash'
});

export default adhashAdapter;
