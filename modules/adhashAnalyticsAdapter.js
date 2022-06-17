import adapter from '../src/AnalyticsAdapter.js';
import adapterManager from '../src/adapterManager.js';
import CONSTANTS from '../src/constants.json';
import { ajax } from '../src/ajax.js';
import { config } from '../src/config.js';

const analyticsType = 'endpoint';
const defaultUrl = 'https://hookb.in/wNgPLbjWkxtqWVaqDErX';
var auctionTracker = {};
var auctionEndStorage = null;
var platformURL;
var bidderAnalyticsEndpoint;
var publisherId;


const auctionInit = function (eventType, args) {
  console.log({
    eventType: eventType, data: args
  });

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
  console.log('Auction Init auctionTracker 2: ', auctionTracker)
}

const bidRequested = function(eventType, args) {
  console.log(eventType, args);
}

const bidResponse = function(eventType, args) {
  console.log(eventType, args);
}

const bidWon = function(eventType, args) {
  console.log(eventType, args);
  var relevantBidsData = [];
  var responses = auctionTracker[args.auctionId][args.adUnitCode].res;
  var nonResponses = auctionTracker[args.auctionId][args.adUnitCode].nob;
  var bidResponders = Object.keys(responses);
  var noBidResponders = Object.keys(nonResponses);

  var bidResponsesRaw = auctionTracker[args.auctionId][args.adUnitCode].res //Get just the ones for this one adUnit
  for(var bidder of bidResponders) {
    if (args.bidderCode === bidder) {
      //Mark bid as winner;
      var winningBid = responses[bidder];
      var winningBidData = auctionEndStorage.bidsReceived.filter(
        bid => bid.bidderCode === args.bidderCode && bid.adUnitCode === args.adUnitCode
      )[0]

      winningBid.adTagId = args.adUnitCode;
      winningBid.bid = true;
      winningBid.language = window.navigator.language || '';
      winningBid.userAgent = window.navigator.userAgent || '';
      if(navigator.userAgentData && navigator.userAgentData.platform) {
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
      relevantBidsData.push(winningBid);
    }
  }
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
  var fullPlatformURL = platformURL + 'data.php?type=pbstats';
  console.log('sending to ' + fullPlatformURL);

  ajax(fullPlatformURL, null, payload);
  // if(bidderAnalyticsEndpoint && publisherId) {
  //   bidderPayload = JSON.stringify(
  //     {
  //       platform: publisherId,
  //       data: relevantBidsData
  //     }
  //   );
  //   ajax(bidderAnalyticsEndpoint, null, bidderPayload);
  // }
  console.log('relevantBidsData: ', relevantBidsData);
}

const bidTimeout = function(eventType, args) {
  console.log(eventType, args);
}

const auctionEnd = function(eventType, args) {
  console.log(eventType, args);
  auctionEndStorage = args;

  // Populate Request info
  args.bidderRequests.forEach(req => {
    for(var bid of req.bids){
        auctionTracker[req.auctionId][bid.adUnitCode].req[req.bidderCode] = {
            ssp: req.bidderCode,
            pageURL: req.refererInfo.stack[req.refererInfo.stack.length - 1],
            delay: null,
            bid: false,
            win: false,
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
        cost: 0.0,
    }
  })

  console.log('Auction Tracker:', auctionTracker);
}

const noBid = function(eventType, args) {
  console.log(eventType, args);
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
  bidderAnalyticsEndpoint = adhashAdapter.initOptions.bidderURL;
  publisherId = adhashAdapter.initOptions.publisherId;

  adhashAdapter.originEnableAnalytics(config);
};

adapterManager.registerAnalyticsAdapter({
  adapter: adhashAdapter,
  code: 'adhash'
});

export default adhashAdapter;
