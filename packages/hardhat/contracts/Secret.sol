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
enum ContentType {
    NONE,    // 0 - for error handling
    TEXT,    // 1
    IMAGE,   // 2
    VIDEO    // 3
}

contract Secret is Ownable, ReentrancyGuard, Pausable {
    // Constants
    uint256 public constant PROTOCOL_FEE_PERCENT = 250; // 5% platform fee
    uint256 public constant SHARE_COMMISSION_PERCENT = 250; // 2.5% commission on shares

    // actual price of teh content will be calculated as
    // actualPrice = basePrice + (basePrice * (PRICE_STEP_PERCENT ** keeps) / 10000)
    uint256 public constant PRICE_STEP_PERCENT = 100; // 1% step for price

    // time to keep content. will be kept automatically after this time
    uint256 public refundTimeLimit;

    uint256 private constant MAX_PRICE = type(uint256).max/10000;

    // Add token addresses as constants
    address public MOXIE;
    address public DEGEN;
    address public constant ETH = address(0); // Use zero address to represent native ETH

    // Content struct
    struct Content {
        ContentType contentType; 
        string contentRef;      // IPFS hash of encrypted content
        string previewRef;      // IPFS hash of preview/thumbnail
        address priceToken;     // Address of the token used for pricing
        uint256 basePrice;      // Base price in wei
        uint256 actualPrice;    // Added field to store current actual price
        address creator;        // Content creator's address
        uint256 purchases;      // Number of purchases
        uint256 refunds;        // Number of refunds
        uint256 keeps;         // Number of keeps
        // TODO: review if these are needed:
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

    // Add this struct after other structs
    struct TokenInfo {
        string name;
        address addr;
        uint256 minValue;
        bool isAllowed;
    }

    // State variables
    uint256 private _contentIds;
    mapping(uint256 => Content) public contents;
    mapping(uint256 => mapping(address => BuyerState)) public buyerStates;

    // Replace the mappings with a single mapping
    mapping(address => TokenInfo) public tokens;

    mapping(address => uint256) public accumulatedFees;
    mapping(address => uint256) public withdrawnFees;

    // Add after other state variables
    mapping(address => uint256) public minPrices;

    // Events
    event ContentCreated(
        uint256 indexed contentId,
        address indexed creator,
        ContentType contentType,
        uint256 basePrice,
        address priceToken
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

    event TokenAdded(address token, uint256 minPrice, string name);
    event TokenRemoved(address token, string name);
    event MinPriceUpdated(address token, uint256 newPrice, string name);

    event RefundTimeLimitUpdated(uint256 oldLimit, uint256 newLimit);

    constructor(
        address initialOwner,
        address moxieAddress,
        address degenAddress
    ) Ownable(initialOwner) {
        MOXIE = moxieAddress;
        DEGEN = degenAddress;
        
        // Initialize tokens with their info
        _addToken("ETH", ETH, 0.0001 ether);
        _addToken("MOXIE", moxieAddress, 1 ether);
        _addToken("DEGEN", degenAddress, 1 ether);

        // Set initial refund time limit (3 hours)
        refundTimeLimit = 3 * 60 * 60;
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
    function _handlePayment(address token, address to, uint256 amount) private {

        if (token == ETH) {
            require(address(this).balance >= amount, "Insufficient contract ETH balance");
            (bool success, ) = to.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            require(IERC20(token).balanceOf(address(this)) >= amount, "Insufficient token balance");
            bool success = IERC20(token).transfer(to, amount);
            require(success, "Token transfer failed");
        }
    }

    // Content Creation Functions
    function createContent(
        ContentType contentType,  
        string memory contentRef,
        string memory previewRef,
        uint256 basePrice,
        address priceToken
    ) public payable whenNotPaused returns (uint256) {
        require(bytes(contentRef).length > 0, "Content reference required");
        require(basePrice >= tokens[priceToken].minValue, "Price below minimum");
        require(tokens[priceToken].isAllowed, "Token not allowed");
        require(basePrice <= MAX_PRICE, "Price above maximum");
        // Handle initial payment from creator
        if (priceToken == ETH) {
            require(msg.value >= basePrice, "Insufficient ETH sent");
            
            // If creator sent more ETH than needed, refund the excess
            uint256 excess = msg.value - basePrice;
            if (excess > 0) {
                (bool refundSuccess, ) = msg.sender.call{value: excess}("");
                require(refundSuccess, "ETH refund failed");
            }
            
        } else {
            require(msg.value == 0, "ETH not accepted for token payments");
            // Check token allowance
            require(
                IERC20(priceToken).allowance(msg.sender, address(this)) >= basePrice,
                "Insufficient token allowance"
            );
            
            // Transfer tokens from creator to the contract
            require(IERC20(priceToken).transferFrom(
                msg.sender, 
                address(this),
                basePrice
            ), "Token transfer failed");
        }

        _contentIds += 1;
        uint256 newContentId = _contentIds;

        contents[newContentId] = Content({
            contentType: contentType,
            contentRef: contentRef,
            previewRef: previewRef,
            basePrice: basePrice,
            actualPrice: basePrice,  // Initialize actualPrice as basePrice
            priceToken: priceToken,
            creator: msg.sender,
            purchases: 0,
            refunds: 0,
            keeps: 0,
            autoPreview: bytes(previewRef).length == 0,
            exists: true
        });

        accumulatedFees[priceToken] += basePrice;

        emit ContentCreated(newContentId, msg.sender, contentType, basePrice, priceToken);
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

        require(tokens[content.priceToken].isAllowed, "Token not allowed");

        // Handle ETH payments
        if (content.priceToken == ETH) {
            require(msg.value >= content.actualPrice, "Insufficient ETH sent");
            require(price == msg.value, "Price must match sent ETH");
            

            
            
        } else {
            // Handle ERC20 token payments
            require(msg.value == 0, "ETH not accepted for token payments");
            require(price >= content.actualPrice, "Insufficient token amount");
            // Check if user has sufficient token balance
            require(IERC20(content.priceToken).balanceOf(msg.sender) >= price, "Insufficient token balance");
            // Check if user has approved contract to spend tokens
            require(IERC20(content.priceToken).allowance(msg.sender, address(this)) >= price, "Token not approved");
            
            // Transfer tokens from user to contract
            require(IERC20(content.priceToken).transferFrom(
                msg.sender, 
                address(this), 
                price
            ), "Token transfer failed");
            
            
        }

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
        _handlePayment(content.priceToken, msg.sender, refundAmount);

        // Handle protocol fee
        uint256 protocolPayment = (buyerState.price * PROTOCOL_FEE_PERCENT) / 10000;
        accumulatedFees[content.priceToken] += protocolPayment;

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
        _handlePayment(content.priceToken, content.creator, creatorPayment);

        // Handle referrer payment
        address payableReferrer = buyerStates[contentId][msg.sender].referrer;
        if (!buyerStates[contentId][payableReferrer].hasKept && payableReferrer != content.creator) {
            payableReferrer = content.creator;
        }
        _handlePayment(content.priceToken, payableReferrer, referrerPayment);

        // Handle protocol fee
        accumulatedFees[content.priceToken] += protocolPayment;

        emit ContentKept(contentId, msg.sender, buyerState.price, payableReferrer, protocolPayment, referrerPayment, creatorPayment);
    }

    // View Functions

    function getContent(uint256 contentId) 
        public 
        view 
        contentExists(contentId) 
        returns (
            ContentType contentType,
            string memory previewRef,
            uint256 basePrice,
            uint256 actualPrice,
            address priceToken,
            address creator,
            uint256 purchases,
            uint256 refunds,
            uint256 keeps
        ) 
    {
        Content memory content = contents[contentId];
        return (
            content.contentType,
            content.previewRef,
            content.basePrice,
            content.actualPrice,
            content.priceToken,
            content.creator,
            content.purchases,
            content.refunds,
            content.keeps
        );
    }

    // Add this function before other view functions
    function getCreatorStats(address creator) public view returns (CreatorStats memory) {
        CreatorStats memory stats;
        
        for (uint256 i = 1; i <= _contentIds; i++) {
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
    function withdrawProtocolFees(address token, uint256 amount) public onlyOwner nonReentrant {
        require(tokens[token].isAllowed, "Token not allowed");
        require(amount > 0, "Amount must be greater than 0");
        
        if (token == ETH) {
            uint256 balance = address(this).balance;
            require(balance >= amount, "Insufficient ETH balance");
            (bool success, ) = owner().call{value: amount}("");
            require(success, "ETH withdrawal failed");
        } else {
            uint256 balance = IERC20(token).balanceOf(address(this));
            require(balance >= amount, "Insufficient token balance");
            require(IERC20(token).transfer(owner(), amount), "Token withdrawal failed");
        }

        accumulatedFees[token] -= amount;
        withdrawnFees[token] += amount;
    }

    // Function to receive ETH
    receive() external payable {}

    // Update helper function
    function _addToken(string memory name, address addr, uint256 minValue) private {
        tokens[addr] = TokenInfo({
            name: name,
            addr: addr,
            minValue: minValue,
            isAllowed: true
        });
        emit TokenAdded(addr, minValue, name);
    }

    // Update admin functions
    function addToken(string memory name, address token, uint256 minValue) external onlyOwner {
        require(token != address(0) || token == ETH, "Invalid token address");
        require(!tokens[token].isAllowed, "Token already added");
        require(minValue > 0, "Minimum price must be greater than 0");
        _addToken(name, token, minValue);
    }

    function removeToken(address token) external onlyOwner {
        require(token != ETH, "Cannot remove ETH");
        require(tokens[token].isAllowed, "Token not allowed");
        tokens[token].isAllowed = false;
        tokens[token].minValue = 0;
        emit TokenRemoved(token, tokens[token].name);
    }

    function setMinPrice(address token, uint256 price) public onlyOwner {
        require(tokens[token].isAllowed, "Token not allowed");
        tokens[token].minValue = price;
        emit MinPriceUpdated(token, price, tokens[token].name);
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
        refundTimeLimit = newLimit;
        emit RefundTimeLimitUpdated(oldLimit, newLimit);
    }
} 