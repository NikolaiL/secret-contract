import { expect } from "chai";
import { ethers } from "hardhat";
import { Secret } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";


describe("Secret Contract", function () {
  let secret: Secret;
  let owner: SignerWithAddress;
  let creator: SignerWithAddress;
  let buyer1: SignerWithAddress;
  let buyer2: SignerWithAddress;
  
  const contentType = 1; // TEXT
  const contentRef = "ipfs://content";
  const previewRef = "ipfs://preview";
  const basePrice = ethers.parseEther("10");

  beforeEach(async () => {
    [owner, creator, buyer1, buyer2] = await ethers.getSigners();


    // Deploy Secret contract
    const Secret = await ethers.getContractFactory("Secret");
    secret = await Secret.deploy(owner.address);

  });

  describe("Content Creation", function () {
    it("Should create content with ETH payment", async function () {
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        { value: basePrice }
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      );
      expect(event).to.exist;
    });

    

    it("Should fail if price is below minimum", async function () {
      // Try to create content with price below minimum
      const lowPrice = ethers.parseEther("0.00000001"); // 0.00001 ETH (below 0.0001 minimum)
      
      await expect(
        secret.connect(creator).createContent(
          contentType,
          contentRef,
          previewRef,
          lowPrice,
          { value: lowPrice }
        )
      ).to.be.revertedWith("Price below minimum");
    });
  });

  describe("Content Purchase and Management", function () {
    let contentId: bigint;

    beforeEach(async function () {
      // Create content with ETH
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        { value: basePrice }
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      );
      contentId = event ? BigInt(event.topics[1]) : 0n;
    });

    it("Should allow buying content", async function () {
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });

      const buyerState = await secret.buyerStates(contentId, buyer1.address);
      expect(buyerState.hasPurchased).to.be.true;
    });

    it("Should allow keeping content", async function () {
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(contentId);

      const buyerState = await secret.buyerStates(contentId, buyer1.address);
      expect(buyerState.hasKept).to.be.true;
    });

    it("Should allow refunding content within refund time limit", async function () {
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).refundContent(contentId);

      const buyerState = await secret.buyerStates(contentId, buyer1.address);
      expect(buyerState.hasRefunded).to.be.true;
    });

    it("Should require sufficient balance to buy", async function () {
      const highPrice = ethers.parseEther("100");
      await expect(
        secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, highPrice, {
          value: ethers.parseEther("0.01")
        })
      ).to.be.revertedWith("Insufficient ETH sent");
    });

    it("Should not allow creator to buy their own content", async function () {
      await expect(
        secret.connect(creator).buyContent(contentId, ethers.ZeroAddress, basePrice, {
          value: basePrice
        })
      ).to.be.revertedWith("Creator cannot buy own content");
    });

    it("Should not allow refunding after time limit", async function () {
      // Buy content first
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });

      // Increase time beyond refund limit
      await ethers.provider.send("evm_increaseTime", [3600 * 24 + 1]); // 1 day + 1 second
      await ethers.provider.send("evm_mine", []);

      // Try to refund
      await expect(
        secret.connect(buyer1).refundContent(contentId)
      ).to.be.revertedWith("Refund period expired");
    });

    it("Should pay referral fee in ETH when using valid referrer", async function () {
      
      // Create content with ETH
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        { value: basePrice }
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      );
      const newContentId = event ? BigInt(event.topics[1]) : 0n;

      // Buyer1 buys and keeps content
      await secret.connect(buyer1).buyContent(newContentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(newContentId);

      // Get buyer1's initial balance
      const initialBalance = await ethers.provider.getBalance(buyer1.address);

      // Get buyer2's initial balance

      // get the new baseprice
      const content = await secret.getContent(newContentId);
      const newBasePrice = content.actualPrice;

      // Buyer2 buys content using buyer1 as referrer
      await secret.connect(buyer2).buyContent(newContentId, buyer1.address, newBasePrice, {
        value: newBasePrice
      });

      await secret.connect(buyer2).keepContent(newContentId);


      // Get buyer1's final balance
      const finalBalance = await ethers.provider.getBalance(buyer1.address);


      // Calculate expected referral fee (5% of price)
      const expectedReferralFee = (newBasePrice * BigInt(500)) / BigInt(10000);


      // Check if buyer1 received the referral fee
      expect(finalBalance - initialBalance).to.equal(expectedReferralFee);
    });


    it("Should not pay referral fee in ETH when referrer hasn't kept the content", async function () {
      
      // Create content with ETH
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        { value: basePrice }
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      );
      const newContentId = event ? BigInt(event.topics[1]) : 0n;

      // Buyer1 buys content but doesn't keep it
      await secret.connect(buyer1).buyContent(newContentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });

      // Get buyer1's initial balance
      const initialBalance = await ethers.provider.getBalance(buyer1.address);

      // Get the new baseprice
      const content = await secret.getContent(newContentId);
      const newBasePrice = content.actualPrice;

      // Buyer2 buys content using buyer1 as referrer
      await secret.connect(buyer2).buyContent(newContentId, buyer1.address, newBasePrice, {
        value: newBasePrice
      });

      // Get buyer1's final balance
      const finalBalance = await ethers.provider.getBalance(buyer1.address);

      // Check that buyer1 did not receive any referral fee
      expect(finalBalance).to.equal(initialBalance);
    });

    it("Should process overpayment correctly with ETH", async function () {
      
      // Create content with ETH
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        { value: basePrice }
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      );
      const newContentId = event ? BigInt(event.topics[1]) : 0n;

      // Buyer1 buys and keeps content
      await secret.connect(buyer1).buyContent(newContentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(newContentId);

      // Get initial balances
      const initialCreatorBalance = await ethers.provider.getBalance(creator.address);
      const initialReferrerBalance = await ethers.provider.getBalance(buyer1.address);

      // Get the content price
      const content = await secret.getContent(newContentId);
      const actualPrice = content.actualPrice;
      const doublePrice = actualPrice * 2n;

      // Buyer2 buys content with 2x payment using buyer1 as referrer
      await secret.connect(buyer2).buyContent(newContentId, buyer1.address, doublePrice, {
        value: doublePrice
      });
      await secret.connect(buyer2).keepContent(newContentId);

      // Get final balances
      const finalCreatorBalance = await ethers.provider.getBalance(creator.address);
      const finalReferrerBalance = await ethers.provider.getBalance(buyer1.address);

      // Calculate expected payments
      const expectedCreatorPayment = (doublePrice * BigInt(9000)) / BigInt(10000); // 90% of double price (100% - 5% protocol - 5% referral)
      const expectedReferralFee = (doublePrice * BigInt(500)) / BigInt(10000); // 5% of double price

      // Check that creator and referrer received correct amounts
      expect(finalCreatorBalance - initialCreatorBalance).to.equal(expectedCreatorPayment);
      expect(finalReferrerBalance - initialReferrerBalance).to.equal(expectedReferralFee);
    });


    it("Should allow owner to change refund time limit", async function () {
      const newTimeLimit = 48 * 60 * 60; // 48 hours
      
      // Change time limit
      await expect(secret.connect(owner).setRefundTimeLimit(newTimeLimit))
        .to.emit(secret, "RefundTimeLimitUpdated")
        .withArgs(24 * 60 * 60, newTimeLimit);

      // Verify new time limit
      expect(await secret.refundTimeLimit()).to.equal(newTimeLimit);

      // Test refund with new time limit
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        { value: basePrice }
      );
      const receipt = await tx.wait();
      const contentId = BigInt(receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      )?.topics[1] ?? "0");

      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });

      // Increase time to just before new limit
      await ethers.provider.send("evm_increaseTime", [newTimeLimit - 60]); // 1 minute before limit
      await ethers.provider.send("evm_mine", []);

      // Should still allow refund
      await expect(secret.connect(buyer1).refundContent(contentId))
        .to.not.be.reverted;
    });

    it("Should not allow setting refund time limit to zero", async function () {
      await expect(secret.connect(owner).setRefundTimeLimit(0))
        .to.be.revertedWith("Time limit must be greater than 0");
    });
  });

  describe("Minimum Prices", function () {
    it("Should allow owner to change minimum price", async function () {
      const newEthMin = ethers.parseEther("0.01");  // 0.01 ETH
      
      // Change minimum price
      await secret.connect(owner).setMinPrice(newEthMin);

      // Verify new minimum price
      expect(await secret.minPrice()).to.equal(newEthMin);

      // Try creating content with new minimum
      await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        newEthMin,
        { value: newEthMin }
      );
    });

    it("Should not allow non-owner to change minimum price", async function () {
      const newEthMin = ethers.parseEther("0.01");  // 0.01 ETH
      
      // Try to change minimum price as non-owner (creator)
      await expect(
        secret.connect(creator).setMinPrice(newEthMin)
      ).to.be.revertedWithCustomError(secret, "OwnableUnauthorizedAccount")
        .withArgs(creator.address);
    });
  });

  describe("Fee Management", function () {
    it("Should allow owner to withdraw accumulated fees", async function () {
      // Create and purchase content to accumulate fees
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        { value: basePrice }
      );
      const receipt = await tx.wait();
      const contentId = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      )?.topics[1];

      // Buy and keep content to generate fees
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(contentId);

      // Get initial balances
      const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
      const initialFees = await secret.accumulatedFees();

      // Owner withdraws fees
      await secret.connect(owner).withdrawProtocolFees(initialFees);

      // Verify balances after withdrawal
      const finalOwnerBalance = await ethers.provider.getBalance(owner.address);
      const finalAccumulatedFees = await secret.accumulatedFees();
      const withdrawnFees = await secret.withdrawnFees();

      expect(finalAccumulatedFees).to.equal(0);
      expect(withdrawnFees).to.equal(initialFees);
      expect(finalOwnerBalance).to.be.gt(initialOwnerBalance);
    });

    it("Should not allow non-owner to withdraw fees", async function () {
      await expect(
        secret.connect(creator).withdrawProtocolFees(ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(secret, "OwnableUnauthorizedAccount")
        .withArgs(creator.address);
    });
  });

  describe("Price Calculation Tests", function () {
    it("Should handle maximum uint256 values safely", async function () {
      const maxPrice = ethers.MaxUint256/10000n;

      // Ensure creator has enough balance for max price content creation
      await ethers.provider.send("hardhat_setBalance", [
        creator.address,
        ethers.toBeHex(maxPrice*2n)
      ]);
      
      await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        maxPrice,
        { value: maxPrice }
      );
    });

    it("Should revert when price exceeds maximum", async function () {
      const tooHighPrice = (ethers.MaxUint256/10000n) + 1n;

      await ethers.provider.send("hardhat_setBalance", [
        creator.address,
        ethers.toBeHex(tooHighPrice*2n)
      ]);
      
      
      await expect(
        secret.connect(creator).createContent(
          contentType,
          contentRef,
          previewRef,
          tooHighPrice,
          { value: tooHighPrice }
        )
      ).to.be.revertedWith("Price above maximum");
    });
    it("Should keep max price unchanged after keep", async function () {
      const maxPrice = ethers.MaxUint256/10000n;

      // Set creator balance for max price content
      await ethers.provider.send("hardhat_setBalance", [
        creator.address,
        ethers.toBeHex(maxPrice*2n)
      ]);

      await ethers.provider.send("hardhat_setBalance", [
        buyer1.address,
        ethers.toBeHex(maxPrice*2n)
      ]);


      
      // Create content at max price
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        maxPrice,
        { value: maxPrice }
      );
      const receipt = await tx.wait();
      const contentId = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      )?.topics[1];

      // Buy content as buyer1
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, maxPrice, {
        value: maxPrice
      });

      // Keep content
      await secret.connect(buyer1).keepContent(contentId);

      // Get content details after keep
      const contentAfterKeep = await secret.getContent(contentId);
      
      // Verify price stayed at max
      expect(contentAfterKeep.actualPrice).to.equal(maxPrice);
    });
  });

  describe("Creator Stats Tests", function () {
    it("Should track creator stats correctly", async function () {
      // Create first content
      await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        { value: basePrice }
      );

      // Create second content
      await secret.connect(creator).createContent(
        contentType,
        "ipfs://content2",
        "ipfs://preview2",
        basePrice,
        { value: basePrice }
      );

      // Get initial stats
      let stats = await secret.getCreatorStats(creator.address);
      expect(stats.publishedContent).to.equal(2);
      expect(stats.totalPurchases).to.equal(0);

      // Buy and keep first content
      await secret.connect(buyer1).buyContent(1, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(1);

      // Buy and refund second content
      await secret.connect(buyer2).buyContent(2, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer2).refundContent(2);

      // Check final stats
      stats = await secret.getCreatorStats(creator.address);
      expect(stats.publishedContent).to.equal(2);
      expect(stats.totalPurchases).to.equal(2);
      expect(stats.totalRefunds).to.equal(1);
      expect(stats.totalKeeps).to.equal(1);
    });
  });
});