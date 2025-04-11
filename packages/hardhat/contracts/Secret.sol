// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title Secret
 * @dev Implements a pay-to-view content system with content creation and management
 */
struct ContentTypeInfo {
    uint256 id;
    string name;
    bool enabled;
    bool exists;
}

contract Secret is Ownable, ReentrancyGuard, Pausable {
    // Constants
    uint256 public constant PROTOCOL_FEE_PERCENT = 500; // 5% platform fee
    uint256 public constant SHARE_COMMISSION_PERCENT = 500; // 5% commission on shares & for owners

    // actual price of teh content will be calculated as
    // actualPrice = basePrice + (basePrice * (PRICE_STEP_PERCENT ** keeps) / 10000)
    uint256 public constant PRICE_STEP_PERCENT = 100; // 1% step for price

    // time to keep content. will be kept automatically after this time
    uint256 public refundTimeLimit;

    uint256 public minPrice;

    uint256 private constant MAX_PRICE = type(uint256).max/10000;

    // Add token addresses as constants

    // Content struct
    struct Content {
        uint256 contentType; 
        string contentRef;      // IPFS hash of encrypted content
        string previewRef;      // IPFS hash of preview/thumbnail
        uint256 basePrice;      // Base price in wei
        uint256 actualPrice;    // Added field to store current actual price
        address creator;        // Content creator's address
        uint256 purchases;      // Number of purchases
        uint256 refunds;        // Number of refunds
        uint256 keeps;         // Number of keeps
        uint256 createdAt;     // Timestamp when content was created
        bool autoPreview;       // Flag for auto-generated preview
        bool exists;            // Check if content exists
    }

    // Buyer state struct
    struct BuyerState {
        bool hasPurchased;
        bool hasRefunded;
        bool hasKept;
        uint256 price;
        uint256 purchaseTime;
        address referrer;
    }

    // Add this struct after other structs
    struct CreatorStats {
        uint256 publishedContent;
        uint256 totalPurchases;
        uint256 totalRefunds;
        uint256 totalKeeps;
    }

    // State variables
    uint256 public contentIds;
    mapping(uint256 => Content) public contents;
    mapping(uint256 => mapping(address => BuyerState)) public buyerStates;

    uint256 public accumulatedFees;
    uint256 public withdrawnFees;

    // Add new state variables at the top of the contract
    mapping(uint256 => ContentTypeInfo) public contentTypes;
    uint256 public contentTypeCount;

    // Events
    event ContentCreated(
        uint256 indexed contentId,
        address indexed creator,
        uint256 contentType,
        uint256 basePrice
    );

    event ContentPurchased(
        uint256 indexed contentId,
        address indexed buyer,
        uint256 price,
        address referrer
    );

    event ContentRefunded(
        uint256 indexed contentId,
        address indexed buyer,
        uint256 amount
    );

    event ContentKept(
        uint256 indexed contentId,
        address indexed buyer,
        uint256 price,
        address referrer,
        uint256 protocolPayment,
        uint256 referrerPayment,
        uint256 creatorPayment
    );

    event MinPriceUpdated(uint256 oldPrice, uint256 newPrice);

    event RefundTimeLimitUpdated(uint256 oldLimit, uint256 newLimit);

    event ContentTypeAdded(uint256 indexed id, string name);
    event ContentTypeUpdated(uint256 indexed id, string name, bool enabled);

    constructor(
        address initialOwner
    ) Ownable(initialOwner) {
        
        // Initialize default content types
        _addContentType("TEXT");    // id 1
        _addContentType("IMAGE");   // id 2
        _addContentType("VIDEO");   // id 3

        // Set initial refund time limit (3 hours)
        refundTimeLimit = 24 * 60 * 60;

        // Set initial min price
        minPrice = 0.0001 ether;
    }

    // Modifiers
    modifier contentExists(uint256 contentId) {
        require(contents[contentId].exists, "Content does not exist");
        _;
    }

    modifier onlyContentCreator(uint256 contentId) {
        require(contents[contentId].creator == msg.sender, "Not content creator");
        _;
    }

    modifier hasPurchased(uint256 contentId) {
        require(buyerStates[contentId][msg.sender].hasPurchased, "Not purchased");
        _;
    }

    modifier hasNotPurchased(uint256 contentId) {
        require(!buyerStates[contentId][msg.sender].hasPurchased, "Already purchased");
        _;
    }

    modifier hasNotRefunded(uint256 contentId) {
        require(!buyerStates[contentId][msg.sender].hasRefunded, "Already refunded");
        _;
    }

    // Helper function to handle payments
    function _handlePayment(address to, uint256 amount) private {

        require(address(this).balance >= amount, "Insufficient contract ETH balance");
        (bool success, ) = to.call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    // Content Creation Functions
    function createContent(
        uint256 contentType,  // Changed from ContentType to uint256
        string memory contentRef,
        string memory previewRef,
        uint256 basePrice
    ) public payable whenNotPaused validContentType(contentType) returns (uint256) {
        require(bytes(contentRef).length > 0, "Content reference required");
        require(basePrice >= minPrice, "Price below minimum");
        require(basePrice <= MAX_PRICE, "Price above maximum");
        // Handle initial payment from creator
        require(msg.value >= basePrice, "Insufficient ETH sent");
        
        // If creator sent more ETH than needed, refund the excess
        uint256 excess = msg.value - basePrice;
        if (excess > 0) {
            (bool refundSuccess, ) = msg.sender.call{value: excess}("");
            require(refundSuccess, "ETH refund failed");
        }
            
        

        contentIds += 1;
        uint256 newContentId = contentIds;

        contents[newContentId] = Content({
            contentType: contentType,
            contentRef: contentRef,
            previewRef: previewRef,
            basePrice: basePrice,
            actualPrice: basePrice,  // Initialize actualPrice as basePrice
            creator: msg.sender,
            purchases: 0,
            refunds: 0,
            keeps: 0,
            createdAt: block.timestamp,  // Add creation timestamp
            autoPreview: bytes(previewRef).length == 0,
            exists: true
        });

        accumulatedFees += basePrice;

        emit ContentCreated(newContentId, msg.sender, contentType, basePrice);
        return newContentId;
    }

    // Purchase Flow Functions
    function buyContent(uint256 contentId, address referrer, uint256 price) 
        public 
        payable
        whenNotPaused
        contentExists(contentId)
        hasNotPurchased(contentId)
        nonReentrant 
    {
        Content storage content = contents[contentId];
        
        // Add check to prevent creator from buying their own content
        require(msg.sender != content.creator, "Creator cannot buy own content");
        require(msg.value >= content.actualPrice, "Insufficient ETH sent");
        require(price == msg.value, "Price must match sent ETH");

        // check if referrer is valid
        // it has to be someone who purchased and kept the content or the creator himself
        // in other cases et it to 0 address.
        if (!buyerStates[contentId][referrer].hasKept && referrer != content.creator) {
            referrer = address(0);
        }

        buyerStates[contentId][msg.sender] = BuyerState({
            hasPurchased: true,
            hasRefunded: false,
            hasKept: false,
            purchaseTime: block.timestamp,
            referrer: referrer,
            price: price
        });

        content.purchases += 1;
        emit ContentPurchased(contentId, msg.sender, price, referrer);
    }

    function refundContent(uint256 contentId) 
        public 
        contentExists(contentId)
        hasPurchased(contentId)
        hasNotRefunded(contentId)
        nonReentrant 
        whenNotPaused
    {
        Content storage content = contents[contentId];
        BuyerState storage buyerState = buyerStates[contentId][msg.sender];

        require(block.timestamp <= buyerState.purchaseTime + refundTimeLimit, "Refund period expired");

        uint256 refundAmount = (buyerState.price * (10000 - PROTOCOL_FEE_PERCENT)) / 10000;
        buyerState.hasRefunded = true;
        content.refunds += 1;

        // Handle refund payment
        _handlePayment(msg.sender, refundAmount);

        // Handle protocol fee
        uint256 protocolPayment = (buyerState.price * PROTOCOL_FEE_PERCENT) / 10000;
        accumulatedFees += protocolPayment;

        emit ContentRefunded(contentId, msg.sender, refundAmount);
    }

    function keepContent(uint256 contentId) 
        public 
        contentExists(contentId)
        hasPurchased(contentId)
        hasNotRefunded(contentId)
        nonReentrant
        whenNotPaused 
    {
        BuyerState storage buyerState = buyerStates[contentId][msg.sender];
        require(!buyerState.hasKept, "Already kept");
        
        Content storage content = contents[contentId];
        content.keeps += 1;

        // Calculate new actual price with overflow protection
        uint256 newPrice = content.actualPrice;
        uint256 increase = (content.actualPrice * PRICE_STEP_PERCENT) / 10000;
        
        if (increase > 0 && newPrice <= MAX_PRICE - increase) {
            content.actualPrice = newPrice + increase;
        } else {
            content.actualPrice = MAX_PRICE;
        }
        
        buyerState.hasKept = true;

        // Calculate payments
        
        uint256 protocolPayment = (buyerState.price * PROTOCOL_FEE_PERCENT) / 10000;
        uint256 referrerPayment = (buyerState.price * SHARE_COMMISSION_PERCENT) / 10000;
        uint256 creatorPayment = buyerState.price - protocolPayment - referrerPayment;

        // Handle creator payment
        _handlePayment(content.creator, creatorPayment);

        // Handle referrer payment
        address payableReferrer = buyerStates[contentId][msg.sender].referrer;
        if (!buyerStates[contentId][payableReferrer].hasKept && payableReferrer != content.creator) {
            payableReferrer = content.creator;
        }
        _handlePayment(payableReferrer, referrerPayment);

        // Handle protocol fee
        accumulatedFees += protocolPayment;

        emit ContentKept(contentId, msg.sender, buyerState.price, payableReferrer, protocolPayment, referrerPayment, creatorPayment);
    }

    // View Functions

    function getContent(uint256 contentId) 
        public 
        view 
        contentExists(contentId) 
        returns (
            uint256 contentType,
            string memory contentRef,
            string memory previewRef,
            uint256 basePrice,
            uint256 actualPrice,
            address creator,
            uint256 purchases,
            uint256 refunds,
            uint256 keeps,
            uint256 createdAt
        ) 
    {
        Content memory content = contents[contentId];
        return (
            content.contentType,
            content.contentRef,
            content.previewRef,
            content.basePrice,
            content.actualPrice,
            content.creator,
            content.purchases,
            content.refunds,
            content.keeps,
            content.createdAt
        );
    }

    // Add this function before other view functions
    function getCreatorStats(address creator) public view returns (CreatorStats memory) {
        CreatorStats memory stats;
        
        for (uint256 i = 1; i <= contentIds; i++) {
            Content storage content = contents[i];
            if (content.exists && content.creator == creator) {
                stats.publishedContent++;
                stats.totalPurchases += content.purchases;
                stats.totalRefunds += content.refunds;
                stats.totalKeeps += content.keeps;
            }
        }
        
        return stats;
    }

    // Admin function to withdraw protocol fees
    function withdrawProtocolFees(uint256 amount) public onlyOwner nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        uint256 balance = address(this).balance;
        require(balance >= amount, "Insufficient ETH balance");
        (bool success, ) = owner().call{value: amount}("");
        require(success, "ETH withdrawal failed");


        accumulatedFees -= amount;
        withdrawnFees += amount;
    }

    // Function to receive ETH
    receive() external payable {}




    function setMinPrice(uint256 price) public onlyOwner {
        require(price > 0, "Price must be greater than 0");
        require(price != minPrice, "New price must be different from old price");
        require(price <= MAX_PRICE, "Price must be less than or equal to MAX_PRICE");
        uint256 oldPrice = minPrice;
        minPrice = price;
        emit MinPriceUpdated(oldPrice, price);
    }

    // Add pause/unpause functions (only owner can call)
    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    // Add setter function
    function setRefundTimeLimit(uint256 newLimit) external onlyOwner {
        require(newLimit > 0, "Time limit must be greater than 0");
        uint256 oldLimit = refundTimeLimit;
        require(newLimit != oldLimit, "New limit must be different from old limit");
        refundTimeLimit = newLimit;
        emit RefundTimeLimitUpdated(oldLimit, newLimit);
    }

    struct ContentView {
        uint256 contentId;
        uint256 contentType;
        string contentRef;
        string previewRef;
        uint256 basePrice;
        uint256 actualPrice;
        address creator;
        uint256 purchases;
        uint256 refunds;
        uint256 keeps;
        uint256 createdAt;
    }

    function getLatestContents(uint256 limit) 
        public 
        view 
        returns (ContentView[] memory) 
    {
        // Adjust limit if it's greater than total contents
        uint256 actualLimit = limit;
        if (actualLimit > contentIds) {
            actualLimit = contentIds;
        }

        // Initialize array with actual size
        ContentView[] memory result = new ContentView[](actualLimit);
        
        // Start from the most recent content and work backwards
        uint256 resultIndex = 0;
        for (uint256 i = contentIds; i > 0 && resultIndex < actualLimit; i--) {
            if (contents[i].exists) {
                Content memory content = contents[i];
                result[resultIndex] = ContentView({
                    contentId: i,
                    contentType: content.contentType,
                    contentRef: content.contentRef,
                    previewRef: content.previewRef,
                    basePrice: content.basePrice,
                    actualPrice: content.actualPrice,
                    creator: content.creator,
                    purchases: content.purchases,
                    refunds: content.refunds,
                    keeps: content.keeps,
                    createdAt: content.createdAt
                });
                resultIndex++;
            }
        }

        return result;
    }

    // Add new functions for content type management
    function _addContentType(string memory name) private {
        require(bytes(name).length > 0, "Name cannot be empty");
        require(bytes(name).length < 100, "Name cannot be longer than 100 characters");
        contentTypeCount++;
        contentTypes[contentTypeCount] = ContentTypeInfo({
            id: contentTypeCount,
            name: name,
            enabled: true,
            exists: true
        });
        emit ContentTypeAdded(contentTypeCount, name);
    }

    function addContentType(string memory name) external onlyOwner {
        require(bytes(name).length > 0, "Name cannot be empty");
        _addContentType(name);
    }

    function updateContentType(uint256 id, string memory name, bool enabled) external onlyOwner {
        require(contentTypes[id].exists, "Content type does not exist");
        require(id != 0, "Cannot modify NONE type");
        require(bytes(name).length > 0, "Name cannot be empty");

        contentTypes[id].name = name;
        contentTypes[id].enabled = enabled;
        
        emit ContentTypeUpdated(id, name, enabled);
    }

    // Add a modifier to check for valid content type
    modifier validContentType(uint256 contentTypeId) {
        require(contentTypes[contentTypeId].exists, "Content type does not exist");
        require(contentTypes[contentTypeId].enabled, "Content type is disabled");
        _;
    }
} 