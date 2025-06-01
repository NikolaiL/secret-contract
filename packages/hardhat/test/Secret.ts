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
  let buyer3: SignerWithAddress;
  let buyer4: SignerWithAddress;

  const contentType = 1; // TEXT
  const contentRef = "ipfs://content";
  const previewRef = "ipfs://preview";
  const basePrice = ethers.parseEther("0.0001");
  const nsfw = false;

  const creatorFee = BigInt(9000);
  const referralFee = BigInt(500/2);
  const ownerFee = BigInt(500/2);
  const shareOwnFeeBps = BigInt(500);
  const priceStepBps = BigInt(100);

  beforeEach(async () => {
    [owner, creator, buyer1, buyer2, buyer3, buyer4] = await ethers.getSigners();


    // Deploy Secret contract
    const Secret = await ethers.getContractFactory("Secret");
    secret = await Secret.deploy(owner.address);

  });

  // Helper function for content creation (now inside describe, so 'secret' is in scope)
  async function createTestContent({
    creator,
    contentType = 1,
    contentRef = "ipfs://content",
    previewRef = "ipfs://preview",
    basePrice = ethers.parseEther("0.0001"),
    shareOwnFeeBps = BigInt(500),
    priceStepBps = BigInt(100),
    nsfw = false,
    value
  }: {
    creator: SignerWithAddress,
    contentType?: number,
    contentRef?: string,
    previewRef?: string,
    basePrice?: bigint,
    shareOwnFeeBps?: bigint,
    priceStepBps?: bigint,
    nsfw?: boolean,
    value?: bigint
  }) {
    const tx = await secret.connect(creator).createContent(
      contentType,
      contentRef,
      previewRef,
      basePrice,
      shareOwnFeeBps,
      priceStepBps,
      nsfw,
      { value: value ?? basePrice }
    );
    const receipt = await tx.wait();
    const event = receipt?.logs.find(
      (log: any) => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
    );
    // Always return a bigint
    return event && event.topics[1] ? BigInt(event.topics[1]) : 0n;
  }

  describe("Content Creation", function () {
    it("Should create content with ETH payment", async function () {
      const contentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });
      expect(contentId).to.be.gt(0n);
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
          shareOwnFeeBps,
          priceStepBps,
          nsfw,
          { value: lowPrice }
        )
      ).to.be.revertedWithCustomError(secret, "PriceBelowMinimum");
    });

    it("Should fail if shareOwnFeeBps over 95%", async function () {
      // Try to create content with price below minimum
      const bigShareOwnFeeBps = BigInt(9501);
      
      await expect(
        secret.connect(creator).createContent(
          contentType,
          contentRef,
          previewRef,
          basePrice,
          bigShareOwnFeeBps,
          priceStepBps,
          nsfw,
          { value: basePrice }
        )
      ).to.be.revertedWithCustomError(secret, "ShareOwnFeeTooHigh");
    });

    it("Should allow to set shareOwnFeeBps to 20%", async function () {
      // Try to create content with price below minimum
      const bigShareOwnFeeBps = BigInt(2000);
      
      await expect(
        secret.connect(creator).createContent(
          contentType,
          contentRef,
          previewRef,
          basePrice,
          bigShareOwnFeeBps,
          priceStepBps,
          nsfw,
          { value: basePrice }
        )
      ).to.not.be.reverted;
    });

    it("Should allow to set price increase to 0", async function () {
      // Try to create content with price below minimum
      const zeroPriceStepBps = BigInt(0);
      
      await expect(
        secret.connect(creator).createContent(
          contentType,
          contentRef,
          previewRef,
          basePrice,
          shareOwnFeeBps,
          zeroPriceStepBps,
          nsfw,
          { value: basePrice }
        )
      ).to.not.be.reverted;
    });

    it("Should allow creator to change nsfw status", async function () {
      const contentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });
      const tx2 = await secret.connect(creator).changeNsfwStatus(contentId, true);
      const receipt2 = await tx2.wait();
      const event2 = receipt2?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("NsfwStatusChanged")?.topicHash
      );
      expect(event2).to.exist;
      const content = await secret.getContent(contentId);
      expect(content.nsfw).to.be.true;
    });

    it("Should allow deployer to change nsfw status", async function () {
      const contentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });
      const tx2 = await secret.connect(owner).changeNsfwStatus(contentId, true);
      const receipt2 = await tx2.wait();
      const event2 = receipt2?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("NsfwStatusChanged")?.topicHash
      );
      expect(event2).to.exist;
      const content = await secret.getContent(contentId);
      expect(content.nsfw).to.be.true;
    });

    it("Should not allow non-creator or non-deployer to change nsfw status", async function () {
      const contentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });
      await expect(secret.connect(buyer1).changeNsfwStatus(contentId, true)).to.be.revertedWithCustomError(secret, "NotContentCreator");
      const content = await secret.getContent(contentId);
      expect(content.nsfw).to.be.false;
    });

  });

  describe("Content Deletion", function () {
    it("Should allow creator to delete content", async function () {
      const contentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });
      const tx2 = await secret.connect(creator).deleteContent(contentId, { value: 0 });
      const receipt2 = await tx2.wait();
      const event2 = receipt2?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentDeleted")?.topicHash
      );
      expect(event2).to.exist;
      const content = await secret.contents(contentId);
      expect(content.exists).to.be.false;
      // After deletion, mapping returns default BuyerState (all false/zero)
      const buyerState = await secret.buyerStates(contentId, buyer1.address);
      expect(buyerState.hasPurchased).to.be.false;
      expect(buyerState.hasRefunded).to.be.false;
      expect(buyerState.hasKept).to.be.false;
      expect(buyerState.price).to.equal(0);
    });

    it ("Should not allow non-creator to delete content", async function () {
      const contentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });
      await expect(secret.connect(buyer1).deleteContent(contentId, { value: 0 }))
        .to.be.revertedWithCustomError(secret, "NotContentCreator");
      const content = await secret.contents(contentId);
      expect(content.exists).to.be.true;
    });
    it ("Should require message value to be equal or more than the total paid by buyers to delete the content", async function () {
      const contentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });
      if (contentId === 0n) throw new Error("Invalid contentId");
      //buy it and keep it
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(contentId);
      // now try to delete it
      await expect(secret.connect(creator).deleteContent(contentId, { value: basePrice/2n }))
        .to.be.revertedWithCustomError(secret, "InsufficientETHSent");
      const content = await secret.contents(contentId);
      expect(content.exists).to.be.true;
    });
    it("Should refund buyers who kept the content", async function () {
      const contentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });
      if (contentId === 0n) throw new Error("Invalid contentId");
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      const buyer1BalanceBefore = await ethers.provider.getBalance(buyer1.address);
      await secret.connect(buyer1).keepContent(contentId);
      // now try to delete it
      const deleteCost = await secret.getDeleteContentCost(contentId);
      await secret.connect(creator).deleteContent(contentId, { value: deleteCost });
      const content = await secret.contents(contentId);
      expect(content.exists).to.be.false;
      const buyer1BalanceAfter = await ethers.provider.getBalance(buyer1.address);
      expect(buyer1BalanceAfter).to.be.gt(buyer1BalanceBefore);
    });
    it("Should refund buyers who did not keep the content", async function () {
      const contentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });
      if (contentId === 0n) throw new Error("Invalid contentId");
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      const buyer1BalanceBefore = await ethers.provider.getBalance(buyer1.address);
      // now try to delete it
      const deleteCost = await secret.getDeleteContentCost(contentId);
      await secret.connect(creator).deleteContent(contentId, { value: deleteCost });
      const content = await secret.contents(contentId);
      expect(content.exists).to.be.false;
      const buyer1BalanceAfter = await ethers.provider.getBalance(buyer1.address);
      expect(buyer1BalanceAfter).to.be.gt(buyer1BalanceBefore);
    });
    it("Should not refund buyers who already refunded", async function () {
      const contentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });
      if (contentId === 0n) throw new Error("Invalid contentId");
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).refundContent(contentId);
      const buyer1BalanceBefore = await ethers.provider.getBalance(buyer1.address);
      const deleteCost = await secret.getDeleteContentCost(contentId);
      await secret.connect(creator).deleteContent(contentId, { value: deleteCost });
      const content = await secret.contents(contentId);
      expect(content.exists).to.be.false;
      const buyer1BalanceAfter = await ethers.provider.getBalance(buyer1.address);
      expect(buyer1BalanceAfter).to.be.equal(buyer1BalanceBefore);
    });
  });

  describe("Content Price Step Functionality", function () {
    

    it("Should respect zero price increase", async function () {
      const priceStepBps = BigInt(0);
      const contentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });

      // keep it
      await secret.connect(buyer1).keepContent(contentId);

      // get the content price
      const content = await secret.getContent(contentId);
      expect(content.actualPrice).to.equal(basePrice);
    });

    it("Should respect 10% price increase", async function () {
      const priceStepBps = BigInt(1000);
      const contentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });

      // keep it
      await secret.connect(buyer1).keepContent(contentId);

      // get the content price
      const content = await secret.getContent(contentId);
      expect(content.actualPrice).to.equal(basePrice*11000n/10000n);
    });
    
  });

  describe("Content Purchase and Management", function () {
    let contentId: bigint;

    beforeEach(async function () {
      // Create content with ETH
      contentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });
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

    it("Should allow keeping content for someone else if the refund time is over", async function () {
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await ethers.provider.send("evm_increaseTime", [3600 * 24 + 1]); // 1 day + 1 second
      await ethers.provider.send("evm_mine", []);
      await secret.connect(buyer2).keepContentFor(contentId, buyer1.address);

      const buyerState = await secret.buyerStates(contentId, buyer1.address);
      expect(buyerState.hasKept).to.be.true;
    });

    it("Should not allow keeping content for someone else if the refund time is not over", async function () {
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await expect(secret.connect(buyer2).keepContentFor(contentId, buyer1.address)).to.be.revertedWithCustomError(secret, "RefundPeriodNotExpired");

      const buyerState = await secret.buyerStates(contentId, buyer1.address);
      expect(buyerState.hasKept).not.to.be.true;
    });

    it("Should not allow keeping content for someone else who did not purchase the content", async function () {
      await expect(secret.connect(buyer2).keepContentFor(contentId, buyer1.address)).to.be.revertedWithCustomError(secret, "NotPurchased");

      const buyerState = await secret.buyerStates(contentId, buyer1.address);
      expect(buyerState.hasKept).not.to.be.true;
    });

    it("Should not allow keeping content for someone else if the already kept", async function () {
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(contentId);

      const buyerState = await secret.buyerStates(contentId, buyer1.address);
      expect(buyerState.hasKept).to.be.true;

      await expect(secret.connect(buyer2).keepContentFor(contentId, buyer1.address)).to.be.revertedWithCustomError(secret, "AlreadyKept");

    });

    it("Should allow refunding content within refund time limit", async function () {
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).refundContent(contentId);

      const buyerState = await secret.buyerStates(contentId, buyer1.address);
      expect(buyerState.hasRefunded).to.be.true;
    });

    it("Should not allow repeated refund", async function () {
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).refundContent(contentId);
      await expect(secret.connect(buyer1).refundContent(contentId)).to.be.revertedWithCustomError(secret, "AlreadyRefunded");
    });

    it("Should not allow repeated keep", async function () {
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(contentId);
      await expect(secret.connect(buyer1).keepContent(contentId)).to.be.revertedWithCustomError(secret, "AlreadyKept");
    });

    it("Should not allow repeated purchase", async function () {
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await expect(secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      })).to.be.revertedWithCustomError(secret, "AlreadyPurchased");
    });

    it("Should not allow refund after keep", async function () {
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(contentId);
      await expect(secret.connect(buyer1).refundContent(contentId)).to.be.revertedWithCustomError(secret, "AlreadyKept");
    });

    it("Should not allow creator to buy their own content", async function () {
      await expect(
        secret.connect(creator).buyContent(contentId, ethers.ZeroAddress, basePrice, {
          value: basePrice
        })
      ).to.be.revertedWithCustomError(secret, "CreatorCannotBuyOwnContent");
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
      ).to.be.revertedWithCustomError(secret, "RefundPeriodExpired");
    });

    it("Should pay referral fee in ETH when using valid referrer", async function () {
      
      // Create content with ETH
      const newContentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });

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
      const finalBalance = await secret.accumulatedReferralFees(buyer1);


      // Calculate expected referral fee (5% of price)
      const expectedReferralFee = (newBasePrice * referralFee) / BigInt(10000);


      // Check if buyer1 received the referral fee
      expect(finalBalance).to.equal(expectedReferralFee);
    });

    it("Should allow creator fee to be withdrawn", async function () {
      
      // Create content with ETH
      const newContentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });

      // Buyer1 buys and keeps content
      await secret.connect(buyer1).buyContent(newContentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(newContentId);
      // Calculate expected referral fee (5% of price)
      const expectedCreatorFee = (basePrice * creatorFee) / BigInt(10000);

      // Check if buyer1 received the referral fee
      //expect(finalBalance).to.equal(expectedReferralFee);

      const initialUserBalance = await ethers.provider.getBalance(creator.address);
      //check if buyer1 can withdraw expectedReferralFee
      const tx2 = await secret.connect(creator).withdrawUserFees(expectedCreatorFee);
      const tx2_receipt = await tx2.wait();
      const gasUsed = tx2_receipt?.gasUsed ?? 0n;
      const gasPrice = tx2_receipt?.gasPrice ?? 0n;
      const gasUsedPrice = gasUsed * gasPrice;

      const finalUserBalance = await ethers.provider.getBalance(creator.address);

      expect(finalUserBalance-initialUserBalance+gasUsedPrice).to.equal(expectedCreatorFee);

    });

    it("Should allow referral fee to be withdrawn", async function () {
      
      // Create content with ETH
      const newContentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });

      // Buyer1 buys and keeps content
      await secret.connect(buyer1).buyContent(newContentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(newContentId);

      // Get buyer2's initial balance

      // get the new baseprice
      const content = await secret.getContent(newContentId);
      const newBasePrice = content.actualPrice;

      // Buyer2 buys content using buyer1 as referrer
      await secret.connect(buyer2).buyContent(newContentId, buyer1.address, newBasePrice, {
        value: newBasePrice
      });

      await secret.connect(buyer2).keepContent(newContentId);

      // Calculate expected referral fee (5% of price)
      const expectedReferralFee = (newBasePrice * referralFee) / BigInt(10000);

      // Check if buyer1 received the referral fee
      //expect(finalBalance).to.equal(expectedReferralFee);

      const initialUserBalance = await ethers.provider.getBalance(buyer1.address);
      //check if buyer1 can withdraw expectedReferralFee
      const tx2 = await secret.connect(buyer1).withdrawUserFees(expectedReferralFee);
      const tx2_receipt = await tx2.wait();
      const gasUsed = tx2_receipt?.gasUsed ?? 0n;
      const gasPrice = tx2_receipt?.gasPrice ?? 0n;
      const gasUsedPrice = gasUsed * gasPrice;

      const finalUserBalance = await ethers.provider.getBalance(buyer1.address);

      expect(finalUserBalance-initialUserBalance+gasUsedPrice).to.equal(expectedReferralFee);

    });

    it("Should not allow referral fee exceeding balance to be withdrawn", async function () {
      
      // Create content with ETH
      const newContentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });

      // Buyer1 buys and keeps content
      await secret.connect(buyer1).buyContent(newContentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(newContentId);
      // Get buyer2's initial balance
      // get the new baseprice
      const content = await secret.getContent(newContentId);
      const newBasePrice = content.actualPrice;
      // Buyer2 buys content using buyer1 as referrer
      await secret.connect(buyer2).buyContent(newContentId, buyer1.address, newBasePrice, {
        value: newBasePrice
      });
      await secret.connect(buyer2).keepContent(newContentId);
      // Calculate expected referral fee (5% of price)
      const expectedReferralFee = (newBasePrice * referralFee) / BigInt(10000);
      const exceedingExpectedReferralFee = expectedReferralFee * BigInt(4);

      expect(await secret.accumulatedReferralFees(buyer1)).to.equal(expectedReferralFee);
      
      await expect(secret.connect(buyer1).withdrawUserFees(exceedingExpectedReferralFee)).to.be.reverted;

    });

    it("Should not allow non-existing balance to be withdrawn", async function () {
      // Calculate expected referral fee (5% of price)
      const nonExistingReferralFee = BigInt(10000);
      await expect(secret.connect(buyer1).withdrawUserFees(nonExistingReferralFee)).to.be.reverted;
    });


    it("Should not pay referral fee in ETH when referrer hasn't kept the content", async function () {
      
      // Create content with ETH
      const newContentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });

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
      const newContentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });

      // Buyer1 buys and keeps content
      await secret.connect(buyer1).buyContent(newContentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(newContentId);

      // Get initial balances
      const initialCreatorBalance = await secret.accumulatedCreatorFees(creator);
      const initialReferrerBalance = await secret.accumulatedReferralFees(buyer1);

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
      const finalCreatorBalance = await secret.accumulatedCreatorFees(creator);
      const finalReferrerBalance = await secret.accumulatedReferralFees(buyer1);

      // Calculate expected payments
      const expectedCreatorPayment = (doublePrice * creatorFee) / BigInt(10000); // 90% of double price (100% - 5% protocol - 5% referral)
      const expectedReferralFee = (doublePrice * referralFee) / BigInt(10000); // 5% of double price

      // Check that creator and referrer received correct amounts
      expect(finalCreatorBalance - initialCreatorBalance).to.equal(expectedCreatorPayment);
      expect(finalReferrerBalance - initialReferrerBalance).to.equal(expectedReferralFee);
    });
  });

  describe("Variable Share and Ownership fees handling", function () {

    it("Should handle 0 share and ownership fees", async function () {
      // Create content with ETH
      const newContentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps: 0n, priceStepBps, nsfw });

      // Buyer1 buys and keeps content
      await secret.connect(buyer1).buyContent(newContentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(newContentId);

      // Get initial balances
      const initialCreatorBalance = await secret.accumulatedCreatorFees(creator);
      const initialReferrerBalance = await secret.accumulatedReferralFees(buyer1);

      // Get the content price
      const content = await secret.getContent(newContentId);
      const actualPrice = content.actualPrice;

      // Buyer2 buys content with 2x payment using buyer1 as referrer
      await secret.connect(buyer2).buyContent(newContentId, buyer1.address, actualPrice, {
        value: actualPrice
      });
      await secret.connect(buyer2).keepContent(newContentId);

      // Get final balances
      const finalCreatorBalance = await secret.accumulatedCreatorFees(creator);
      const finalReferrerBalance = await secret.accumulatedReferralFees(buyer1);

      // Calculate expected payments
      const expectedCreatorPayment = (actualPrice * BigInt(9500)) / BigInt(10000); // 95% of  price (100% - 5% protocol)
      const expectedReferralFee = 0n; // 0

      // Check that creator and referrer received correct amounts
      expect(finalCreatorBalance - initialCreatorBalance).to.equal(expectedCreatorPayment);
      expect(finalReferrerBalance - initialReferrerBalance).to.equal(expectedReferralFee);

    });

    it("Should handle 20% share and ownership fees", async function () {
      // Create content with ETH
      const newContentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps: 2000n, priceStepBps, nsfw });

      // Buyer1 buys and keeps content
      await secret.connect(buyer1).buyContent(newContentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(newContentId);

      // Get initial balances
      const initialCreatorBalance = await secret.accumulatedCreatorFees(creator);
      const initialReferrerBalance = await secret.accumulatedReferralFees(buyer1);
      const initialOwnerBalance = await secret.accumulatedOwnerFees(buyer1);

      // Get the content price
      const content = await secret.getContent(newContentId);
      const actualPrice = content.actualPrice;

      // Buyer2 buys content with 2x payment using buyer1 as referrer
      await secret.connect(buyer2).buyContent(newContentId, buyer1.address, actualPrice, {
        value: actualPrice
      });
      await secret.connect(buyer2).keepContent(newContentId);

      // Get final balances
      const finalCreatorBalance = await secret.accumulatedCreatorFees(creator);
      const finalReferrerBalance = await secret.accumulatedReferralFees(buyer1);
      const finalOwnerBalance = await secret.accumulatedOwnerFees(buyer1);

      // Calculate expected payments
      const expectedCreatorPayment = (actualPrice * BigInt(7500)) / BigInt(10000); // 75% of  price (100% - 5% protocol - 20% share and ownership)
      const expectedReferralFee = (actualPrice * BigInt(1000)) / BigInt(10000); // 10% of  price
      const expectedOwnerFee = (actualPrice * BigInt(1000)) / BigInt(10000); // 10% of  price

      // Check that creator and referrer received correct amounts
      expect(finalCreatorBalance - initialCreatorBalance).to.equal(expectedCreatorPayment);
      expect(finalReferrerBalance - initialReferrerBalance).to.equal(expectedReferralFee);
      expect(finalOwnerBalance - initialOwnerBalance).to.equal(expectedOwnerFee);

    });

    it("Should handle 95% share and ownership fees", async function () {
      // Create content with ETH
      const newContentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps: 9500n, priceStepBps, nsfw });

      // Buyer1 buys and keeps content
      await secret.connect(buyer1).buyContent(newContentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(newContentId);

      // Get initial balances
      const initialCreatorBalance = await secret.accumulatedCreatorFees(creator);
      const initialReferrerBalance = await secret.accumulatedReferralFees(buyer1);
      const initialOwnerBalance = await secret.accumulatedOwnerFees(buyer1);

      // Get the content price
      const content = await secret.getContent(newContentId);
      const actualPrice = content.actualPrice;

      // Buyer2 buys content with 2x payment using buyer1 as referrer
      await secret.connect(buyer2).buyContent(newContentId, buyer1.address, actualPrice, {
        value: actualPrice
      });
      await secret.connect(buyer2).keepContent(newContentId);

      // Get final balances
      const finalCreatorBalance = await secret.accumulatedCreatorFees(creator);
      const finalReferrerBalance = await secret.accumulatedReferralFees(buyer1);
      const finalOwnerBalance = await secret.accumulatedOwnerFees(buyer1);

      // Calculate expected payments
      const expectedCreatorPayment = (actualPrice * BigInt(0)) / BigInt(10000); // 0
      const expectedReferralFee = (actualPrice * BigInt(4750)) / BigInt(10000); // 47.5%
      const expectedOwnerFee = (actualPrice * BigInt(4750)) / BigInt(10000); // 47.5% 

      // Check that creator and referrer received correct amounts
      expect(finalCreatorBalance - initialCreatorBalance).to.equal(expectedCreatorPayment);
      expect(finalReferrerBalance - initialReferrerBalance).to.equal(expectedReferralFee);
      expect(finalOwnerBalance - initialOwnerBalance).to.equal(expectedOwnerFee);

    });

  });

  describe("Owner functions", function () {
    let contentId: bigint;

    beforeEach(async function () {
      // Create content with ETH
      contentId = await createTestContent({ creator, contentType, contentRef, previewRef, basePrice, shareOwnFeeBps, priceStepBps, nsfw });
    });

    it("Should add buyer to a list of owners of a content", async function () {
      const lengthBefore = await secret.getContentOwnerCount(contentId);
      expect(lengthBefore).to.equal(0);
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(contentId);
      const lengthAfter = await secret.getContentOwnerCount(contentId);
      expect(lengthAfter).to.equal(1);

      const owner = await secret.getContentOwner(contentId, 0);
      expect(owner).to.equal(buyer1.address);
    
    });

    it('Should accumulate ownership fees', async function () {


      var expectedBuyer1OwnerFee = BigInt(0);
      var expectedBuyer2OwnerFee = BigInt(0);
      var expectedBuyer3OwnerFee = BigInt(0);
      
      // buyer1 buys content
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(contentId);
      
      // get the new baseprice
      var content = await secret.getContent(contentId);
      var newBasePrice = content.actualPrice;

      // Buyer2 buys content 
      await secret.connect(buyer2).buyContent(contentId, ethers.ZeroAddress, newBasePrice, {
        value: newBasePrice
      });
      await secret.connect(buyer2).keepContent(contentId);
      // now, buyer1 should have 100% of the content ownership fee
      expectedBuyer1OwnerFee += newBasePrice*ownerFee/BigInt(10000);
      expect(await secret.accumulatedOwnerFees(buyer1)).to.equal(expectedBuyer1OwnerFee);

      // buyer3 buys content
      content = await secret.getContent(contentId);
      newBasePrice = content.actualPrice;
      await secret.connect(buyer3).buyContent(contentId, ethers.ZeroAddress, newBasePrice, {
        value: newBasePrice
      });
      await secret.connect(buyer3).keepContent(contentId);
      // now, buyer1 should have 100% of the content ownership fee
      expectedBuyer1OwnerFee += (newBasePrice*ownerFee/BigInt(10000))/2n;
      expectedBuyer2OwnerFee += (newBasePrice*ownerFee/BigInt(10000))/2n;
      expect(await secret.accumulatedOwnerFees(buyer1)).to.equal(expectedBuyer1OwnerFee);
      expect(await secret.accumulatedOwnerFees(buyer2)).to.equal(expectedBuyer2OwnerFee);

      // buyer4 buys content
      content = await secret.getContent(contentId);
      newBasePrice = content.actualPrice;
      await secret.connect(buyer4).buyContent(contentId, ethers.ZeroAddress, newBasePrice, {
        value: newBasePrice
      });
      await secret.connect(buyer4).keepContent(contentId);
      // now, buyer1 should have 100% of the content ownership fee
      expectedBuyer1OwnerFee += (newBasePrice*ownerFee/BigInt(10000))/3n;
      expectedBuyer2OwnerFee += (newBasePrice*ownerFee/BigInt(10000))/3n;
      expectedBuyer3OwnerFee += (newBasePrice*ownerFee/BigInt(10000))/3n;
      expect(await secret.accumulatedOwnerFees(buyer1)).to.equal(expectedBuyer1OwnerFee);
      expect(await secret.accumulatedOwnerFees(buyer2)).to.equal(expectedBuyer2OwnerFee);
      expect(await secret.accumulatedOwnerFees(buyer3)).to.equal(expectedBuyer3OwnerFee);
    });
  });

  describe("Contract Management", function () {


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
        shareOwnFeeBps,
        priceStepBps,
        nsfw,
        { value: basePrice }
      );
      const receipt = await tx.wait();
      const contentId = BigInt(
        receipt?.logs.find(
          (log: any) => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
        )?.topics[1] ?? "0"
      );

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
        .to.be.revertedWithCustomError(secret, "AmountMustBeGreaterThanZero");
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
        shareOwnFeeBps,
        priceStepBps,
        nsfw,
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

  describe("Fee Management", function  () {
    it("Should allow owner to withdraw accumulated fees", async function () {
      // Create and purchase content to accumulate fees
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        shareOwnFeeBps,
        priceStepBps,
        nsfw,
        { value: basePrice }
      );
      const receipt = await tx.wait();
      const contentId = BigInt(
        receipt?.logs.find(
          (log: any) => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
        )?.topics[1] ?? "0"
      );

      // Buy and keep content to generate fees
      await secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice, {
        value: basePrice
      });
      await secret.connect(buyer1).keepContent(contentId);

      // Get initial balances
      const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
      const initialFees = await secret.accumulatedProtocolFees();

      // Owner withdraws fees
      await secret.connect(owner).withdrawProtocolFees(initialFees);

      // Verify balances after withdrawal
      const finalOwnerBalance = await ethers.provider.getBalance(owner.address);
      const finalAccumulatedFees = await secret.accumulatedProtocolFees();
      const withdrawnFees = await secret.withdrawnProtocolFees();

      expect(finalAccumulatedFees).to.equal(initialFees);
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
        shareOwnFeeBps,
        priceStepBps,
        nsfw,
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
          shareOwnFeeBps,
          priceStepBps,
          nsfw,
          { value: tooHighPrice }
        )
      ).to.be.revertedWithCustomError(secret, "PriceAboveMaximum");
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
        shareOwnFeeBps,
        priceStepBps,
        nsfw,
        { value: maxPrice }
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find((log: any) => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash);
      const contentId: bigint = event ? BigInt(event.topics[1]) : 0n;
      if (contentId === 0n) throw new Error("Failed to get contentId from event");

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
});