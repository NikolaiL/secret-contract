// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title Secret
 * @notice Implements a pay-to-view content system with content creation and management
 * @dev This contract allows users to create, buy, keep, refund, and manage content with ETH payments and referral/ownership fee logic.
 */
contract Secret is Ownable, ReentrancyGuard, Pausable {
    /**
     * @notice 5% platform fee in basis points
     */
    uint256 public constant PROTOCOL_FEE_BPS = 500; // 5% platform fee
    /**
     * @notice 5% commission on referrals & for owners (half goes to referral, half to all the owners of the content)
     */
    uint256 public constant SHARE_COMMISSION_BPS = 500;
    /**
     * @notice 1% step for price increase in basis points
     * @dev actualPrice = basePrice + (basePrice * (PRICE_STEP_BPS ** keeps) / 10000)
     */
    uint256 public constant PRICE_STEP_BPS = 100;
    /**
     * @notice Time to keep content. Will be kept automatically after this time (in seconds)
     */
    uint256 public refundTimeLimit;
    /**
     * @notice Minimum price for content (in wei)
     */
    uint256 public minPrice;
    /**
     * @dev Maximum allowed price for content
     */
    uint256 private constant MAX_PRICE = type(uint256).max/10000;
    /**
     * @dev Maximum allowed share/ownership fee in basis points
     */
    uint256 private constant MAX_SHARE_OWN_FEE_BPS = 9500;
    /**
     * @notice Counter for content IDs
     */
    uint256 public contentIds;
    /**
     * @notice Mapping from contentId to Content struct
     */
    mapping(uint256 => Content) public contents;
    /**
     * @notice Mapping from contentId and address to BuyerState struct
     */
    mapping(uint256 => mapping(address => BuyerState)) public buyerStates;
    /**
     * @notice Mapping from contentId to array of owner addresses
     */
    mapping(uint256 => address[]) public contentOwnerAddresses;
    /**
     * @notice Mapping from contentId to array of buyer addresses
     */
    mapping(uint256 => address[]) public contentBuyerAddresses;
    /**
     * @notice Accumulated protocol fees (in wei)
     */
    uint256 public accumulatedProtocolFees;
    /**
     * @notice Withdrawn protocol fees (in wei)
     */
    uint256 public withdrawnProtocolFees;
    /**
     * @notice Mapping from address to accumulated creator fees (in wei)
     */
    mapping(address => uint256) public accumulatedCreatorFees;
    /**
     * @notice Mapping from address to accumulated referral fees (in wei)
     */
    mapping(address => uint256) public accumulatedReferralFees;
    /**
     * @notice Mapping from address to accumulated owner fees (in wei)
     */
    mapping(address => uint256) public accumulatedOwnerFees;
    /**
     * @notice Mapping from address to withdrawn user fees (in wei)
     */
    mapping(address => uint256) public withdrawnUserFees;
    /**
     * @notice Mapping from contentTypeId to ContentTypeInfo struct
     */
    mapping(uint256 => ContentTypeInfo) public contentTypes;
    /**
     * @notice Counter for content types
     */
    uint256 public contentTypeCount;

    /**
     * @notice Struct representing content details
     * @param contentType The type of content (e.g., TEXT, IMAGE, VIDEO)
     * @param contentRef IPFS hash of encrypted content
     * @param previewRef IPFS hash of preview/thumbnail
     * @param basePrice Base price in wei
     * @param shareOwnFeeBps Share of the price for the owner in bps
     * @param priceStepBps Price step in bps
     * @param actualPrice Current actual price
     * @param creator Content creator's address
     * @param purchases Number of purchases
     * @param refunds Number of refunds
     * @param keeps Number of keeps
     * @param createdAt Timestamp when content was created
     * @param autoPreview Flag for auto-generated preview
     * @param exists Whether content exists
     * @param nsfw Whether content is NSFW
     */
    struct Content {
        uint256 contentType;
        string contentRef;
        string previewRef;
        uint256 basePrice;
        uint256 shareOwnFeeBps;
        uint256 priceStepBps;
        uint256 actualPrice;
        address creator;
        uint256 purchases;
        uint256 refunds;
        uint256 keeps;
        uint256 createdAt;
        bool autoPreview;
        bool exists;
        bool nsfw;
    }

    /**
     * @notice Struct representing content type information
     * @param id Content type ID
     * @param name Name of the content type
     * @param enabled Whether the content type is enabled
     * @param exists Whether the content type exists
     */
    struct ContentTypeInfo {
        uint256 id;
        string name;
        bool enabled;
        bool exists;
    }

    /**
     * @notice Struct representing the state of a buyer for a given content
     * @param hasPurchased Whether the buyer has purchased
     * @param hasRefunded Whether the buyer has refunded
     * @param hasKept Whether the buyer has kept
     * @param price Price paid by the buyer
     * @param purchaseTime Timestamp of purchase
     * @param referrer Referrer's address
     */
    struct BuyerState {
        bool hasPurchased;
        bool hasRefunded;
        bool hasKept;
        uint256 price;
        uint256 purchaseTime;
        address referrer;
    }

    /**
     * @notice Struct for content view (used in view functions)
     */
    struct ContentView {
        uint256 contentId;
        uint256 contentType;
        string contentRef;
        string previewRef;
        uint256 basePrice;
        uint256 shareOwnFeeBps;
        uint256 priceStepBps;
        uint256 actualPrice;
        address creator;
        uint256 purchases;
        uint256 refunds;
        uint256 keeps;
        uint256 createdAt;
        bool nsfw;
    }

    // Events
    /**
     * @notice Emitted when content is created
     * @param contentId The ID of the created content
     * @param creator The address of the creator
     * @param contentType The type of content
     * @param basePrice The base price
     * @param shareOwnFeeBps The share/ownership fee in bps
     * @param priceStepBps The price step in bps
     */
    event ContentCreated(
        uint256 indexed contentId,
        address indexed creator,
        uint256 contentType,
        uint256 basePrice,
        uint256 shareOwnFeeBps,
        uint256 priceStepBps
    );

    /**
     * @notice Emitted when content is purchased
     * @param contentId The ID of the content
     * @param buyer The address of the buyer
     * @param price The price of the content
     * @param paidPrice The price paid
     * @param referrer The referrer address
     */
    event ContentPurchased(
        uint256 indexed contentId,
        address indexed buyer,
        uint256 price,
        uint256 paidPrice,
        address referrer
    );

    /**
     * @notice Emitted when content is refunded
     * @param contentId The ID of the content
     * @param buyer The address of the buyer
     * @param amount The amount refunded
     */
    event ContentRefunded(
        uint256 indexed contentId,
        address indexed buyer,
        uint256 amount
    );

    /**
     * @notice Emitted when content is kept
     * @param contentId The ID of the content
     * @param buyer The address of the buyer
     * @param nonce The keep nonce
     * @param price The price paid
     * @param referrer The referrer address
     * @param protocolPayment The protocol fee paid
     * @param referrerPayment The referral fee paid
     * @param perOwnerPayment The per-owner fee paid
     * @param creatorPayment The creator fee paid
     */
    event ContentKept(
        uint256 indexed contentId,
        address indexed buyer,
        uint256 nonce, 
        uint256 price,
        address referrer,
        uint256 protocolPayment,
        uint256 referrerPayment,
        uint256 perOwnerPayment,
        uint256 creatorPayment
    );

    /**
     * @notice Emitted when the minimum price is updated
     * @param oldPrice The old minimum price
     * @param newPrice The new minimum price
     */
    event MinPriceUpdated(uint256 oldPrice, uint256 newPrice);

    /**
     * @notice Emitted when the refund time limit is updated
     * @param oldLimit The old refund time limit
     * @param newLimit The new refund time limit
     */
    event RefundTimeLimitUpdated(uint256 oldLimit, uint256 newLimit);

    /**
     * @notice Emitted when a new content type is added
     * @param id The content type ID
     * @param name The name of the content type
     */
    event ContentTypeAdded(uint256 indexed id, string name);
    /**
     * @notice Emitted when a content type is updated
     * @param id The content type ID
     * @param name The name of the content type
     * @param enabled Whether the content type is enabled
     */
    event ContentTypeUpdated(uint256 indexed id, string name, bool enabled);

    /**
     * @notice Emitted when NSFW status is changed
     * @param contentId The content ID
     * @param sender The address changing the status
     * @param nsfw The new NSFW status
     */
    event NsfwStatusChanged(uint256 indexed contentId, address indexed sender, bool nsfw);

    /**
     * @notice Emitted when content is deleted
     * @param contentId The content ID
     */
    event ContentDeleted(uint256 indexed contentId);

    // Custom errors
    error ContentDoesNotExist();
    error NotContentCreator();
    error NotPurchased();
    error NotKept();
    error AlreadyKept();
    error AlreadyPurchased();
    error AlreadyRefunded();
    error ContentTypeDoesNotExist();
    error ContentTypeDisabled();
    error InsufficientETHSent();
    error PriceBelowMinimum();
    error PriceAboveMaximum();
    error ShareOwnFeeTooHigh();
    error CreatorCannotBuyOwnContent();
    error PriceMustMatchSentETH();
    error RefundPeriodExpired();
    error RefundPeriodNotExpired();
    error NoBuyersForContent();
    error AmountMustBeGreaterThanZero();
    error InsufficientProtocolFeesBalance();
    error InsufficientETHBalance();
    error ETHWithdrawalFailed();
    error InsufficientFeesBalance();
    error NameCannotBeEmpty();
    error NameTooLong();
    error CannotModifyNoneType();
    error NewPriceMustBeDifferent();
    error NewLimitMustBeDifferent();

    /**
     * @notice Contract constructor
     * @param initialOwner The initial owner address
     */
    constructor(
        address initialOwner
    ) Ownable(initialOwner) {
        // Initialize default content types
        _addContentType("TEXT");    // id 1
        _addContentType("IMAGE");   // id 2
        _addContentType("VIDEO");   // id 3
        // Set initial refund time limit (24 hours)
        refundTimeLimit = 24 * 60 * 60;
        // Set initial min price
        minPrice = 0.0001 ether;
    }

    // Modifiers
    /**
     * @notice Ensures the content exists
     * @param contentId The content ID
     */
    modifier contentExists(uint256 contentId) {
        if (!contents[contentId].exists) revert ContentDoesNotExist();
        _;
    }
    /**
     * @notice Ensures the caller is the content creator
     * @param contentId The content ID
     */
    modifier onlyContentCreator(uint256 contentId) {
        if (contents[contentId].creator != msg.sender) revert NotContentCreator();
        _;
    }
    /**
     * @notice Ensures the buyer has purchased the content
     * @param contentId The content ID
     * @param buyer The buyer address
     */
    modifier hasPurchased(uint256 contentId, address buyer) {
        if (!buyerStates[contentId][buyer].hasPurchased) revert NotPurchased();
        _;
    }
    /**
     * @notice Ensures the buyer has kept the content
     * @param contentId The content ID
     * @param buyer The buyer address
     */
    modifier hasKept(uint256 contentId, address buyer) {
        if (!buyerStates[contentId][buyer].hasKept) revert NotKept();
        _;
    }
    /**
     * @notice Ensures the buyer has not kept the content
     * @param contentId The content ID
     * @param buyer The buyer address
     */
    modifier hasNotKept(uint256 contentId, address buyer) {
        if (buyerStates[contentId][buyer].hasKept) revert AlreadyKept();
        _;
    }
    /**
     * @notice Ensures the buyer has not purchased the content
     * @param contentId The content ID
     * @param buyer The buyer address
     */
    modifier hasNotPurchased(uint256 contentId, address buyer) {
        if (buyerStates[contentId][buyer].hasPurchased) revert AlreadyPurchased();
        _;
    }
    /**
     * @notice Ensures the buyer has not refunded the content
     * @param contentId The content ID
     * @param buyer The buyer address
     */
    modifier hasNotRefunded(uint256 contentId, address buyer) {
        if (buyerStates[contentId][buyer].hasRefunded) revert AlreadyRefunded();
        _;
    }
    /**
     * @notice Ensures the content type is valid and enabled
     * @param contentTypeId The content type ID
     */
    modifier validContentType(uint256 contentTypeId) {
        if (!contentTypes[contentTypeId].exists) revert ContentTypeDoesNotExist();
        if (!contentTypes[contentTypeId].enabled) revert ContentTypeDisabled();
        _;
    }

    /**
     * @notice Receive function to accept ETH
     */
    receive() external payable {}

    // Functions

    /**
     * @dev Helper function to handle ETH payments
     * @param to The recipient address
     * @param amount The amount to send (in wei)
     */
    function _handlePayment(address to, uint256 amount) private {
        if (address(this).balance < amount) revert InsufficientETHBalance();
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert ETHWithdrawalFailed();
    }

    /**
     * @notice Create new content and pay the base price
     * @dev Only valid content types are allowed. The creator must send at least the base price in ETH.
     * @param contentType The type of content (content type ID)
     * @param contentRef The IPFS hash of the encrypted content
     * @param previewRef The IPFS hash of the preview/thumbnail
     * @param basePrice The base price in wei
     * @param shareOwnFeeBps The share/ownership fee in basis points
     * @param priceStepBps The price step in basis points
     * @param nsfw Whether the content is NSFW
     * @return The new content ID
     */
    function createContent(
        uint256 contentType,
        string memory contentRef,
        string memory previewRef,
        uint256 basePrice,
        uint256 shareOwnFeeBps,
        uint256 priceStepBps,
        bool nsfw
    ) public payable whenNotPaused validContentType(contentType) returns (uint256) {
        if (bytes(contentRef).length == 0) revert ContentDoesNotExist();
        if (basePrice < minPrice) revert PriceBelowMinimum();
        if (basePrice > MAX_PRICE) revert PriceAboveMaximum();
        if (shareOwnFeeBps > MAX_SHARE_OWN_FEE_BPS) revert ShareOwnFeeTooHigh();
        if (msg.value < basePrice) revert InsufficientETHSent();

        contentIds += 1;
        uint256 newContentId = contentIds;

        contents[newContentId] = Content({
            contentType: contentType,
            contentRef: contentRef,
            previewRef: previewRef,
            basePrice: basePrice,
            shareOwnFeeBps: shareOwnFeeBps,
            priceStepBps: priceStepBps,
            actualPrice: basePrice,  // Initialize actualPrice as basePrice
            creator: msg.sender,
            purchases: 0,
            refunds: 0,
            keeps: 0,
            createdAt: block.timestamp,  // Add creation timestamp
            autoPreview: bytes(previewRef).length == 0,
            exists: true,
            nsfw: nsfw
        });

        accumulatedProtocolFees += msg.value;

        emit ContentCreated(newContentId, msg.sender, contentType, basePrice, shareOwnFeeBps, priceStepBps);
        return newContentId;
    }

    /**
     * @notice Change the NSFW status of a content item
     * @dev Only the creator or contract owner can change NSFW status
     * @param contentId The content ID
     * @param nsfw The new NSFW status
     */
    function changeNsfwStatus(uint256 contentId, bool nsfw) public {
        if (!contents[contentId].exists) revert ContentDoesNotExist();
        if (msg.sender != contents[contentId].creator && msg.sender != owner()) revert NotContentCreator();
        contents[contentId].nsfw = nsfw;
        emit NsfwStatusChanged(contentId, msg.sender, nsfw);
    }

    /**
     * @notice Buy content by paying the current price
     * @dev Referrer must have kept the content or be the creator, otherwise set to zero address
     * @param contentId The content ID
     * @param referrer The referrer address
     * @param price The price to pay (must match msg.value)
     */
    function buyContent(uint256 contentId, address referrer, uint256 price)
        public
        payable
        whenNotPaused
        contentExists(contentId)
        hasNotPurchased(contentId, msg.sender)
        nonReentrant
    {
        Content storage content = contents[contentId];
        
        if (msg.sender == content.creator) revert CreatorCannotBuyOwnContent();
        if (msg.value < content.actualPrice) revert InsufficientETHSent();
        if (price != msg.value) revert PriceMustMatchSentETH();

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
        contentBuyerAddresses[contentId].push(msg.sender);
        emit ContentPurchased(contentId, msg.sender, content.actualPrice, price, referrer);
    }

    /**
     * @notice Refund a purchased content within the refund time limit
     * @dev Only possible if not kept or already refunded
     * @param contentId The content ID
     */
    function refundContent(uint256 contentId)
        public
        contentExists(contentId)
        hasPurchased(contentId, msg.sender)
        hasNotKept(contentId, msg.sender)
        hasNotRefunded(contentId, msg.sender)
        nonReentrant
        whenNotPaused
    {
        Content storage content = contents[contentId];
        BuyerState storage buyerState = buyerStates[contentId][msg.sender];

        if (block.timestamp > buyerState.purchaseTime + refundTimeLimit) revert RefundPeriodExpired();

        uint256 refundAmount = (buyerState.price * (10000 - PROTOCOL_FEE_BPS)) / 10000;
        buyerState.hasRefunded = true;
        content.refunds += 1;

        // Handle refund payment
        _handlePayment(msg.sender, refundAmount);

        // Handle protocol fee
        uint256 protocolPayment = (buyerState.price * PROTOCOL_FEE_BPS) / 10000;
        accumulatedProtocolFees += protocolPayment;

        // remove buyer from buyerAddresses
        _removeBuyerFromContent(contentId, msg.sender);

        emit ContentRefunded(contentId, msg.sender, refundAmount);
    }

    /**
     * @notice Keep content for yourself (finalize purchase)
     * @param contentId The content ID
     */
    function keepContent(uint256 contentId)
        public
    {
        keepContentFor(contentId, msg.sender);
    }

    /**
     * @notice Keep content for another buyer (after refund period)
     * @dev Only possible if refund period is over for the buyer
     * @param contentId The content ID
     * @param buyer The buyer address
     */
    function keepContentFor(uint256 contentId, address buyer)
        public
        contentExists(contentId)
        hasPurchased(contentId, buyer)
        hasNotKept(contentId, buyer)
        hasNotRefunded(contentId, buyer)
        nonReentrant
        whenNotPaused
    {
        if (buyer != msg.sender) {
            if (block.timestamp <= buyerStates[contentId][buyer].purchaseTime + refundTimeLimit) revert RefundPeriodNotExpired();
        }
        BuyerState storage buyerState = buyerStates[contentId][buyer];
        if (buyerState.hasKept) revert AlreadyKept();
        
        Content storage content = contents[contentId];

        // Calculate new actual price with overflow protection
        uint256 newPrice = content.actualPrice;
        uint256 increase = (content.actualPrice * content.priceStepBps) / 10000;
        
        if (increase >= 0 && newPrice <= MAX_PRICE - increase) {
            content.actualPrice = newPrice + increase;
        } else {
            content.actualPrice = MAX_PRICE;
        }
        // Calculate payments
        
        uint256 protocolPayment = (buyerState.price * PROTOCOL_FEE_BPS) / 10000;
        uint256 referrerPayment = (buyerState.price * content.shareOwnFeeBps) / 10000 /2;
        uint256 ownerPayment = (buyerState.price * content.shareOwnFeeBps) / 10000 / 2;
        uint256 creatorPayment = buyerState.price - protocolPayment - referrerPayment - ownerPayment;

        // handle creator fees
        accumulatedCreatorFees[content.creator] += creatorPayment;

        // Handle referrer payment
        address payableReferrer = buyerStates[contentId][buyer].referrer;
        if (!buyerStates[contentId][payableReferrer].hasKept && payableReferrer != content.creator) {
            payableReferrer = content.creator;
        }
        accumulatedReferralFees[payableReferrer] += referrerPayment;

        // Handle protocol fee
        accumulatedProtocolFees += protocolPayment;

        uint256 ownerPaymentPerOwner;

        // Handle owner payment
        if (content.keeps == 0) {
            accumulatedOwnerFees[content.creator] += ownerPayment;
            ownerPaymentPerOwner = ownerPayment;
        } else {
            ownerPaymentPerOwner = ownerPayment / content.keeps;
            for (uint256 i = 0; i < content.keeps; i++) {
                address owner = contentOwnerAddresses[contentId][i];
                accumulatedOwnerFees[owner] += ownerPaymentPerOwner;
            }
        }

        content.keeps += 1;
        buyerState.hasKept = true;
        contentOwnerAddresses[contentId].push(buyer);
        // remove buyer from buyerAddresses
        _removeBuyerFromContent(contentId, buyer);

        emit ContentKept(contentId, buyer, content.keeps, buyerState.price, payableReferrer, protocolPayment, referrerPayment, ownerPaymentPerOwner, creatorPayment);
    }

    /**
     * @dev Remove a buyer from the content's buyer address list
     * @param contentId The content ID
     * @param buyer The buyer address
     */
    function _removeBuyerFromContent(uint256 contentId, address buyer) private {
        if (contentBuyerAddresses[contentId].length == 0) revert NoBuyersForContent();
        for (uint256 i = 0; i < contentBuyerAddresses[contentId].length; i++) {
            if (contentBuyerAddresses[contentId][i] == buyer) {
                contentBuyerAddresses[contentId][i] = contentBuyerAddresses[contentId][contentBuyerAddresses[contentId].length - 1];
                contentBuyerAddresses[contentId].pop();
                break;
            }
        }
    }

    /**
     * @notice Delete content and refund buyers/owners as needed
     * @dev Only the creator can delete. Must send enough ETH to cover refunds.
     * @param contentId The content ID
     */
    function deleteContent(uint256 contentId)
        public
        payable
        whenNotPaused
        nonReentrant
        contentExists(contentId)
        onlyContentCreator(contentId)
    {
        // first we should calculate the total paid by buyers
        uint256 totalPaid = getDeleteContentCost(contentId);
        // now the messaege value must be equal or more
        if (msg.value < totalPaid) revert InsufficientETHSent();

        // now we should refund the buyers
        for (uint256 i = 0; i < contentOwnerAddresses[contentId].length; i++) {
            address owner = contentOwnerAddresses[contentId][i];
            _handlePayment(owner, buyerStates[contentId][owner].price);
        }

        // now, we should find everyone who purchased but did not keep and refund full price from contract balance
        // we should go through all the buyerStates for this content
        for (uint256 i = 0; i < contentBuyerAddresses[contentId].length; i++) {
            address buyer = contentBuyerAddresses[contentId][i];
            if (!buyerStates[contentId][buyer].hasKept && !buyerStates[contentId][buyer].hasRefunded) {
                _handlePayment(buyer, buyerStates[contentId][buyer].price);
            }
        }

        delete contents[contentId];

        // we should also delete all buyer states
        for (uint256 i = 0; i < contentOwnerAddresses[contentId].length; i++) {
            address owner = contentOwnerAddresses[contentId][i];
            delete buyerStates[contentId][owner];
        }

        // we should also delete all content owner addresses
        delete contentOwnerAddresses[contentId];

        // we should also delete all content buyer addresses
        delete contentBuyerAddresses[contentId];

        emit ContentDeleted(contentId);
    }

    /**
     * @notice Get the number of owners for a content
     * @param contentId The content ID
     * @return The number of owners
     */
    function getContentOwnerCount(uint256 contentId) public view returns (uint256) {
        return contentOwnerAddresses[contentId].length;
    }

    /**
     * @notice Get the address of a content owner by index
     * @param contentId The content ID
     * @param index The index in the owner list
     * @return The owner address
     */
    function getContentOwner(uint256 contentId, uint256 index) public view returns (address) {
        return contentOwnerAddresses[contentId][index];
    }

    /**
     * @notice Get content details
     * @param contentId The content ID
     * @return contentType The type of content
     * @return contentRef The IPFS hash of the encrypted content
     * @return previewRef The IPFS hash of the preview/thumbnail
     * @return basePrice The base price in wei
     * @return shareOwnFeeBps The share/ownership fee in basis points
     * @return priceStepBps The price step in basis points
     * @return actualPrice The current actual price
     * @return creator The creator's address
     * @return purchases The number of purchases
     * @return refunds The number of refunds
     * @return keeps The number of keeps
     * @return createdAt The creation timestamp
     * @return nsfw Whether the content is NSFW
     */
    function getContent(uint256 contentId)
        public
        view
        contentExists(contentId)
        returns (
            uint256 contentType,
            string memory contentRef,
            string memory previewRef,
            uint256 basePrice,
            uint256 shareOwnFeeBps,
            uint256 priceStepBps,
            uint256 actualPrice,
            address creator,
            uint256 purchases,
            uint256 refunds,
            uint256 keeps,
            uint256 createdAt,
            bool nsfw
        )
    {
        Content memory content = contents[contentId];
        return (
            content.contentType,
            content.contentRef,
            content.previewRef,
            content.basePrice,
            content.shareOwnFeeBps,
            content.priceStepBps,
            content.actualPrice,
            content.creator,
            content.purchases,
            content.refunds,
            content.keeps,
            content.createdAt,
            content.nsfw
        );
    }

    /**
     * @notice Get the total cost required to delete content (sum of all owner payments)
     * @param contentId The content ID
     * @return The total cost in wei
     */
    function getDeleteContentCost(uint256 contentId) public view returns (uint256) {
        uint256 totalPaid = 0;
        for (uint256 i = 0; i < contentOwnerAddresses[contentId].length; i++) {
            address owner = contentOwnerAddresses[contentId][i];
            totalPaid += buyerStates[contentId][owner].price;
        }
        return totalPaid;
    }

    /**
     * @notice Withdraw protocol fees (only owner)
     * @dev Only callable by the contract owner
     * @param amount The amount to withdraw (in wei)
     */
    function withdrawProtocolFees(uint256 amount) public onlyOwner nonReentrant {
        if (amount == 0) revert AmountMustBeGreaterThanZero();
        if (amount > accumulatedProtocolFees - withdrawnProtocolFees) revert InsufficientProtocolFeesBalance();
        
        uint256 balance = address(this).balance;
        if (balance < amount) revert InsufficientETHBalance();
        (bool success, ) = owner().call{value: amount}("");
        if (!success) revert ETHWithdrawalFailed();

        withdrawnProtocolFees += amount;
    }

    /**
     * @notice Withdraw user fees (creator, referrer, or owner)
     * @param amount The amount to withdraw (in wei)
     */
    function withdrawUserFees(uint256 amount) public {
        if (amount == 0) revert AmountMustBeGreaterThanZero();

        if (amount > accumulatedCreatorFees[msg.sender] + accumulatedReferralFees[msg.sender] + accumulatedOwnerFees[msg.sender] - withdrawnUserFees[msg.sender]) revert InsufficientFeesBalance();
        
        uint256 balance = address(this).balance;
        if (balance < amount) revert InsufficientETHBalance();
        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert ETHWithdrawalFailed();

        withdrawnUserFees[msg.sender] += amount;
    }

    /**
     * @notice Set the minimum price for content (only owner)
     * @param price The new minimum price (in wei)
     */
    function setMinPrice(uint256 price) public onlyOwner {
        if (price == 0) revert AmountMustBeGreaterThanZero();
        if (price == minPrice) revert NewPriceMustBeDifferent();
        if (price > MAX_PRICE) revert PriceAboveMaximum();
        uint256 oldPrice = minPrice;
        minPrice = price;
        emit MinPriceUpdated(oldPrice, price);
    }

    /**
     * @notice Pause the contract (only owner)
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract (only owner)
     */
    function unpause() public onlyOwner {
        _unpause();
    }

    /**
     * @notice Set the refund time limit (only owner)
     * @param newLimit The new refund time limit (in seconds)
     */
    function setRefundTimeLimit(uint256 newLimit) external onlyOwner {
        if (newLimit == 0) revert AmountMustBeGreaterThanZero();
        uint256 oldLimit = refundTimeLimit;
        if (newLimit == oldLimit) revert NewLimitMustBeDifferent();
        refundTimeLimit = newLimit;
        emit RefundTimeLimitUpdated(oldLimit, newLimit);
    }

    /**
     * @dev Add a new content type (internal helper)
     * @param name The name of the content type
     */
    function _addContentType(string memory name) private {
        if (bytes(name).length == 0) revert NameCannotBeEmpty();
        if (bytes(name).length >= 100) revert NameTooLong();
        contentTypeCount++;
        contentTypes[contentTypeCount] = ContentTypeInfo({
            id: contentTypeCount,
            name: name,
            enabled: true,
            exists: true
        });
        emit ContentTypeAdded(contentTypeCount, name);
    }

    /**
     * @notice Add a new content type (only owner)
     * @param name The name of the content type
     */
    function addContentType(string memory name) external onlyOwner {
        require(bytes(name).length > 0, "Name cannot be empty");
        _addContentType(name);
    }

    /**
     * @notice Update a content type (only owner)
     * @param id The content type ID
     * @param name The new name
     * @param enabled Whether the content type is enabled
     */
    function updateContentType(uint256 id, string memory name, bool enabled) external onlyOwner {
        if (!contentTypes[id].exists) revert ContentTypeDoesNotExist();
        if (id == 0) revert CannotModifyNoneType();
        if (bytes(name).length == 0) revert NameCannotBeEmpty();

        contentTypes[id].name = name;
        contentTypes[id].enabled = enabled;
        
        emit ContentTypeUpdated(id, name, enabled);
    }
} 