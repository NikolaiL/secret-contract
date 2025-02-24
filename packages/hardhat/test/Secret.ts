import { expect } from "chai";
import { ethers } from "hardhat";
import { Secret, MockToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";


describe("Secret Contract", function () {
  let secret: Secret;
  let moxie: MockToken;
  let degen: MockToken;
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

    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockToken");
    moxie = await MockToken.deploy("Moxie Token", "MOXIE");
    degen = await MockToken.deploy("Degen Token", "DEGEN");

    // Deploy Secret contract
    const Secret = await ethers.getContractFactory("Secret");
    secret = await Secret.deploy(owner.address, await moxie.getAddress(), await degen.getAddress());

    // Mint tokens to creator and buyer
    await moxie.mint(creator.address, ethers.parseEther("1000"));
    await moxie.mint(buyer1.address, ethers.parseEther("1000"));
    await moxie.mint(buyer2.address, ethers.parseEther("1000"));
    await degen.mint(creator.address, ethers.parseEther("1000"));
    await degen.mint(buyer1.address, ethers.parseEther("1000"));
    await degen.mint(buyer2.address, ethers.parseEther("1000"));
  });

  describe("Content Creation", function () {
    it("Should create content with ETH payment", async function () {
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        ethers.ZeroAddress, // ETH
        { value: basePrice }
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      );
      expect(event).to.exist;
    });

    it("Should create content with DEGEN token", async function () {
      const degenAddress = await degen.getAddress();
      await degen.connect(creator).approve(await secret.getAddress(), basePrice);

      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        degenAddress
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      );
      expect(event).to.exist;
    });

    it("Should create content with MOXIE token", async function () {
      const moxieAddress = await moxie.getAddress();
      await moxie.connect(creator).approve(await secret.getAddress(), basePrice);

      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        moxieAddress
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      );
      expect(event).to.exist;
    });

    it("Should fail if DEGEN balance is insufficient", async function () {
      const degenAddress = await degen.getAddress();
      await degen.connect(creator).transfer(owner.address, ethers.parseEther("1000")); // Transfer all tokens away
      await degen.connect(creator).approve(await secret.getAddress(), basePrice);

      await expect(
        secret.connect(creator).createContent(
          contentType,
          contentRef,
          previewRef,
          basePrice,
          degenAddress
        )
      ).to.be.revertedWithCustomError(degen, "ERC20InsufficientBalance");
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
          ethers.ZeroAddress,
          { value: lowPrice }
        )
      ).to.be.revertedWith("Price below minimum");

      // Try with MOXIE token below minimum (1 MOXIE)
      const moxieAddress = await moxie.getAddress();
      const lowTokenPrice = ethers.parseEther("0.05"); // 0.5 MOXIE
      await moxie.connect(creator).approve(await secret.getAddress(), lowTokenPrice);

      await expect(
        secret.connect(creator).createContent(
          contentType,
          contentRef,
          previewRef,
          lowTokenPrice,
          moxieAddress
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
        ethers.ZeroAddress,
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

    it("Should require token allowance to buy", async function () {
      // Create content with DEGEN token
      const degenAddress = await degen.getAddress();
      await degen.connect(creator).approve(await secret.getAddress(), basePrice);
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        degenAddress
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      );
      const tokenContentId = event ? BigInt(event.topics[1]) : 0n;

      await expect(
        secret.connect(buyer1).buyContent(tokenContentId, ethers.ZeroAddress, basePrice)
      ).to.be.revertedWith("Token not approved");
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
        ethers.ZeroAddress,
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


      // Calculate expected referral fee (2.5% of price)
      const expectedReferralFee = (newBasePrice * BigInt(250)) / BigInt(10000);


      // Check if buyer1 received the referral fee
      expect(finalBalance - initialBalance).to.equal(expectedReferralFee);
    });

    it("Should pay referral fee in MOXIE when using valid referrer", async function () {
      const moxieAddress = await moxie.getAddress();

      
      // Create content with MOXIE
      await moxie.connect(creator).approve(await secret.getAddress(), basePrice);
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        moxieAddress
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      );
      const newContentId = event ? BigInt(event.topics[1]) : 0n;

      // Buyer1 buys and keeps content
      await moxie.connect(buyer1).approve(await secret.getAddress(), basePrice);
      await secret.connect(buyer1).buyContent(newContentId, ethers.ZeroAddress, basePrice);
      await secret.connect(buyer1).keepContent(newContentId);

      // Get buyer1's initial MOXIE balance
      const initialBalance = await moxie.balanceOf(buyer1.address);

      // Get the new baseprice
      const content = await secret.getContent(newContentId);
      const newBasePrice = content.actualPrice;

      // Buyer2 buys content using buyer1 as referrer
      await moxie.connect(buyer2).approve(await secret.getAddress(), newBasePrice);
      await secret.connect(buyer2).buyContent(newContentId, buyer1.address, newBasePrice);
      await secret.connect(buyer2).keepContent(newContentId);

      // Get buyer1's final MOXIE balance
      const finalBalance = await moxie.balanceOf(buyer1.address);

      // Calculate expected referral fee (2.5% of price)
      const expectedReferralFee = (newBasePrice * BigInt(250)) / BigInt(10000);

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
        ethers.ZeroAddress,
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

    it("Should not pay referral fee in MOXIE when referrer hasn't kept the content", async function () {
      const moxieAddress = await moxie.getAddress();
      
      // Create content with MOXIE
      await moxie.connect(creator).approve(await secret.getAddress(), basePrice);
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        moxieAddress
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      );
      const newContentId = event ? BigInt(event.topics[1]) : 0n;

      // Buyer1 buys content but doesn't keep it
      await moxie.connect(buyer1).approve(await secret.getAddress(), basePrice);
      await secret.connect(buyer1).buyContent(newContentId, ethers.ZeroAddress, basePrice);

      // Get buyer1's initial MOXIE balance
      const initialBalance = await moxie.balanceOf(buyer1.address);

      // Get the new baseprice
      const content = await secret.getContent(newContentId);
      const newBasePrice = content.actualPrice;

      // Buyer2 buys content using buyer1 as referrer
      await moxie.connect(buyer2).approve(await secret.getAddress(), newBasePrice);
      await secret.connect(buyer2).buyContent(newContentId, buyer1.address, newBasePrice);

      // Get buyer1's final MOXIE balance
      const finalBalance = await moxie.balanceOf(buyer1.address);

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
        ethers.ZeroAddress,
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
      const expectedCreatorPayment = (doublePrice * BigInt(9500)) / BigInt(10000); // 95% of double price
      const expectedReferralFee = (doublePrice * BigInt(250)) / BigInt(10000); // 2.5% of double price

      // Check that creator and referrer received correct amounts
      expect(finalCreatorBalance - initialCreatorBalance).to.equal(expectedCreatorPayment);
      expect(finalReferrerBalance - initialReferrerBalance).to.equal(expectedReferralFee);
    });

    it("Should process overpayment correctly with MOXIE", async function () {
      const moxieAddress = await moxie.getAddress();
      
      // Create content with MOXIE
      await moxie.connect(creator).approve(await secret.getAddress(), basePrice);
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        moxieAddress
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      );
      const newContentId = event ? BigInt(event.topics[1]) : 0n;

      // Buyer1 buys and keeps content
      await moxie.connect(buyer1).approve(await secret.getAddress(), basePrice);
      await secret.connect(buyer1).buyContent(newContentId, ethers.ZeroAddress, basePrice);
      await secret.connect(buyer1).keepContent(newContentId);

      // Get initial balances
      const initialCreatorBalance = await moxie.balanceOf(creator.address);
      const initialReferrerBalance = await moxie.balanceOf(buyer1.address);

      // Get the content price
      const content = await secret.getContent(newContentId);
      const actualPrice = content.actualPrice;
      const doublePrice = actualPrice * 2n;

      // Buyer2 buys content with 2x payment using buyer1 as referrer
      await moxie.connect(buyer2).approve(await secret.getAddress(), doublePrice);
      await secret.connect(buyer2).buyContent(newContentId, buyer1.address, doublePrice);
      await secret.connect(buyer2).keepContent(newContentId);

      // Get final balances
      const finalCreatorBalance = await moxie.balanceOf(creator.address);
      const finalReferrerBalance = await moxie.balanceOf(buyer1.address);

      // Calculate expected payments
      const expectedCreatorPayment = (doublePrice * BigInt(9500)) / BigInt(10000); // 95% of double price
      const expectedReferralFee = (doublePrice * BigInt(250)) / BigInt(10000); // 2.5% of double price

      // Check that creator and referrer received correct amounts
      expect(finalCreatorBalance - initialCreatorBalance).to.equal(expectedCreatorPayment);
      expect(finalReferrerBalance - initialReferrerBalance).to.equal(expectedReferralFee);
    });

    it("Should allow owner to change refund time limit", async function () {
      const newTimeLimit = 24 * 60 * 60; // 24 hours
      
      // Change time limit
      await expect(secret.connect(owner).setRefundTimeLimit(newTimeLimit))
        .to.emit(secret, "RefundTimeLimitUpdated")
        .withArgs(3 * 60 * 60, newTimeLimit);

      // Verify new time limit
      expect(await secret.refundTimeLimit()).to.equal(newTimeLimit);

      // Test refund with new time limit
      const tx = await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        basePrice,
        ethers.ZeroAddress,
        { value: basePrice }
      );
      const receipt = await tx.wait();
      const contentId = receipt?.logs.find(
        log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
      )?.topics[1];

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
      const newTokenMin = ethers.parseEther("5");    // 5 tokens
      
      // Change minimum prices
      await secret.connect(owner).setMinPrice(ethers.ZeroAddress, newEthMin);
      await secret.connect(owner).setMinPrice(await moxie.getAddress(), newTokenMin);

      // Verify new minimums using tokens mapping
      const ethInfo = await secret.tokens(ethers.ZeroAddress);
      const moxieInfo = await secret.tokens(await moxie.getAddress());
      expect(ethInfo.minValue).to.equal(newEthMin);
      expect(moxieInfo.minValue).to.equal(newTokenMin);

      // Try creating content with new minimums
      await secret.connect(creator).createContent(
        contentType,
        contentRef,
        previewRef,
        newEthMin,
        ethers.ZeroAddress,
        { value: newEthMin }
      );
    });

    it("Should not allow non-owner to change minimum price", async function () {
      const newEthMin = ethers.parseEther("0.01");  // 0.01 ETH
      
      // Try to change minimum price as non-owner (creator)
      await expect(
        secret.connect(creator).setMinPrice(ethers.ZeroAddress, newEthMin)
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
        ethers.ZeroAddress,
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
      const initialFees = await secret.accumulatedFees(ethers.ZeroAddress);

      // Owner withdraws fees
      await secret.connect(owner).withdrawProtocolFees(ethers.ZeroAddress, initialFees);

      // Verify balances after withdrawal
      const finalOwnerBalance = await ethers.provider.getBalance(owner.address);
      const finalAccumulatedFees = await secret.accumulatedFees(ethers.ZeroAddress);
      const withdrawnFees = await secret.withdrawnFees(ethers.ZeroAddress);

      expect(finalAccumulatedFees).to.equal(0);
      expect(withdrawnFees).to.equal(initialFees);
      expect(finalOwnerBalance).to.be.gt(initialOwnerBalance);
    });

    it("Should not allow non-owner to withdraw fees", async function () {
      await expect(
        secret.connect(creator).withdrawProtocolFees(ethers.ZeroAddress, ethers.parseEther("1"))
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
        ethers.ZeroAddress,
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
          ethers.ZeroAddress,
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
        ethers.ZeroAddress,
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

  describe("Token Safety Tests", function () {
    it("Should prevent token double-spending", async function () {
        // Create content with MOXIE token
        const moxieAddress = await moxie.getAddress();
        await moxie.connect(creator).approve(await secret.getAddress(), basePrice);
        
        const tx = await secret.connect(creator).createContent(
            contentType,
            contentRef,
            previewRef,
            basePrice,
            moxieAddress
        );
        const receipt = await tx.wait();
        const contentId = receipt?.logs.find(
            log => log.topics[0] === secret.interface.getEvent("ContentCreated")?.topicHash
        )?.topics[1];

        // Approve tokens but transfer them away before purchase
        await moxie.connect(buyer1).approve(await secret.getAddress(), basePrice);
        await moxie.connect(buyer1).transfer(buyer2.address, await moxie.balanceOf(buyer1.address));

        await expect(
            secret.connect(buyer1).buyContent(contentId, ethers.ZeroAddress, basePrice)
        ).to.be.revertedWith("Insufficient token balance");
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
        ethers.ZeroAddress,
        { value: basePrice }
      );

      // Create second content
      await secret.connect(creator).createContent(
        contentType,
        "ipfs://content2",
        "ipfs://preview2",
        basePrice,
        ethers.ZeroAddress,
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

  describe("Token Management", function () {
    it("Should allow owner to add and remove tokens", async function () {
      const newToken = await (await ethers.getContractFactory("MockToken"))
        .deploy("New Token", "NEW");
      const tokenAddress = await newToken.getAddress();
      
      // Add new token
      const minPrice = ethers.parseEther("0.5");
      await secret.connect(owner).addToken("NEW", tokenAddress, minPrice);
      
      // Verify token was added
      const tokenInfo = await secret.tokens(tokenAddress);
      expect(tokenInfo.name).to.equal("NEW");
      expect(tokenInfo.addr).to.equal(tokenAddress);
      expect(tokenInfo.minValue).to.equal(minPrice);
      expect(tokenInfo.isAllowed).to.be.true;

      // Remove token
      await secret.connect(owner).removeToken(tokenAddress);
      
      // Verify token was removed
      const removedToken = await secret.tokens(tokenAddress);
      expect(removedToken.isAllowed).to.be.false;
      expect(removedToken.minValue).to.equal(0);
    });

    it("Should not allow removing ETH as payment method", async function () {
      await expect(
        secret.connect(owner).removeToken(ethers.ZeroAddress)
      ).to.be.revertedWith("Cannot remove ETH");
    });

    it("Should emit correct events", async function () {
      const newToken = await (await ethers.getContractFactory("MockToken"))
        .deploy("Test Token", "TEST");
      const tokenAddress = await newToken.getAddress();
      const minPrice = ethers.parseEther("1");

      // Test TokenAdded event
      await expect(secret.connect(owner).addToken("TEST", tokenAddress, minPrice))
        .to.emit(secret, "TokenAdded")
        .withArgs(tokenAddress, minPrice, "TEST");

      // Test MinPriceUpdated event
      const newMinPrice = ethers.parseEther("2");
      await expect(secret.connect(owner).setMinPrice(tokenAddress, newMinPrice))
        .to.emit(secret, "MinPriceUpdated")
        .withArgs(tokenAddress, newMinPrice, "TEST");

      // Test TokenRemoved event
      await expect(secret.connect(owner).removeToken(tokenAddress))
        .to.emit(secret, "TokenRemoved")
        .withArgs(tokenAddress, "TEST");
    });
  });
});