"use client";

import type { NextPage } from "next";
import { formatEther } from "viem";
import { Address } from "~~/components/scaffold-eth";
import { useScaffoldEventHistory, useScaffoldReadContract } from "~~/hooks/scaffold-eth";

const Events: NextPage = () => {
  const fromBlock = process.env.FROM_BLOCK ? BigInt(process.env.FROM_BLOCK) : 0n;

  const { data: ContentCreatedEvents, isLoading: isContentCreatedLoading } = useScaffoldEventHistory({
    contractName: "Secret",
    eventName: "ContentCreated",
    fromBlock,
  });

  const { data: ContentPurchasedEvents, isLoading: isContentPurchasedLoading } = useScaffoldEventHistory({
    contractName: "Secret",
    eventName: "ContentPurchased",
    fromBlock,
  });

  const { data: ContentKeptEvents, isLoading: isContentKeptLoading } = useScaffoldEventHistory({
    contractName: "Secret",
    eventName: "ContentKept",
    fromBlock,
  });

  const { data: ContentRefundedEvents, isLoading: isContentRefundedLoading } = useScaffoldEventHistory({
    contractName: "Secret",
    eventName: "ContentRefunded",
    fromBlock,
  });

  const { data: TokenAddedEvents, isLoading: isTokenAddedLoading } = useScaffoldEventHistory({
    contractName: "Secret",
    eventName: "TokenAdded",
    fromBlock,
  });

  const { data: TokenRemovedEvents, isLoading: isTokenRemovedLoading } = useScaffoldEventHistory({
    contractName: "Secret",
    eventName: "TokenRemoved",
    fromBlock,
  });

  const { data: MinPriceUpdatedEvents, isLoading: isMinPriceUpdatedLoading } = useScaffoldEventHistory({
    contractName: "Secret",
    eventName: "MinPriceUpdated",
    fromBlock,
  });

  const { data: RefundTimeLimitUpdatedEvents, isLoading: isRefundTimeLimitUpdatedLoading } = useScaffoldEventHistory({
    contractName: "Secret",
    eventName: "RefundTimeLimitUpdated",
    fromBlock,
  });

  const { data: ContentTypeAddedEvents, isLoading: isContentTypeAddedLoading } = useScaffoldEventHistory({
    contractName: "Secret",
    eventName: "ContentTypeAdded",
    fromBlock,
  });

  const { data: ContentTypeUpdatedEvents, isLoading: isContentTypeUpdatedLoading } = useScaffoldEventHistory({
    contractName: "Secret",
    eventName: "ContentTypeUpdated",
    fromBlock,
  });

  const { data: contentTypeName } = useScaffoldReadContract({
    contractName: "Secret",
    functionName: "getContentTypeName",
    args: [ContentCreatedEvents?.[0]?.args.contentType],
  });

  return (
    <>
      <div className="flex items-center flex-col flex-grow pt-10">
        {isContentCreatedLoading ? (
          <div className="flex justify-center items-center mt-10">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : (
          <div>
            <div className="text-center mb-4">
              <span className="block text-2xl font-bold">Content Created Events</span>
            </div>
            <div className="overflow-x-auto shadow-lg">
              <table className="table table-zebra w-full">
                <thead>
                  <tr>
                    <th className="bg-primary">Address</th>
                    <th className="bg-primary">Content ID</th>
                    <th className="bg-primary">Content Type</th>
                    <th className="bg-primary">Base Price</th>
                    <th className="bg-primary">Referral & Owner Share %</th>
                    <th className="bg-primary">Price Increase %</th>
                  </tr>
                </thead>
                <tbody>
                  {!ContentCreatedEvents || ContentCreatedEvents.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-center">
                        No events found
                      </td>
                    </tr>
                  ) : (
                    ContentCreatedEvents?.map((event, index) => {
                      return (
                        <tr key={index}>
                          <td className="text-center">
                            <Address address={event.args.creator} />
                          </td>
                          <td>{event.args.contentId?.toString()}</td>
                          <td>{contentTypeName}</td>
                          <td>{parseFloat(formatEther(event.args.basePrice || 0n)).toFixed(6)}</td>
                          <td>{(parseFloat(event.args.shareOwnFeeBps?.toString() || "0") / 100).toFixed(2)}</td>
                          <td>{(parseFloat(event.args.priceStepBps?.toString() || "0") / 100).toFixed(2)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isContentPurchasedLoading ? (
          <div className="flex justify-center items-center mt-10">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : (
          <div className="mt-8">
            <div className="text-center mb-4">
              <span className="block text-2xl font-bold">Content Purchased Events</span>
            </div>
            <div className="overflow-x-auto shadow-lg">
              <table className="table table-zebra w-full">
                <thead>
                  <tr>
                    <th className="bg-primary">Address</th>
                    <th className="bg-primary">Content ID</th>
                    <th className="bg-primary">Price</th>
                    <th className="bg-primary">Paid Price</th>
                    <th className="bg-primary">Referral</th>
                  </tr>
                </thead>
                <tbody>
                  {!ContentPurchasedEvents || ContentPurchasedEvents.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-center">
                        No events found
                      </td>
                    </tr>
                  ) : (
                    ContentPurchasedEvents?.map((event, index) => {
                      return (
                        <tr key={index}>
                          <td className="text-center">
                            <Address address={event.args.buyer} />
                          </td>
                          <td>{event.args.contentId?.toString()}</td>
                          <td>{parseFloat(formatEther(event.args.price || 0n)).toFixed(6)}</td>
                          <td>{parseFloat(formatEther(event.args.paidPrice || 0n)).toFixed(6)}</td>
                          <td>{event.args.referrer}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isContentKeptLoading ? (
          <div className="flex justify-center items-center mt-10">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : (
          <div className="mt-8">
            <div className="text-center mb-4">
              <span className="block text-2xl font-bold">Content Kept Events</span>
            </div>
            <div className="overflow-x-auto shadow-lg">
              <table className="table table-zebra w-full">
                <thead>
                  <tr>
                    <th className="bg-primary">Address</th>
                    <th className="bg-primary">Content ID</th>
                    <th className="bg-primary">Nonce</th>
                    <th className="bg-primary">Price</th>
                    <th className="bg-primary">Referrer</th>
                    <th className="bg-primary">Protocol Payment</th>
                    <th className="bg-primary">Referrer Payment</th>
                    <th className="bg-primary">Creator Payment</th>
                    <th className="bg-primary">Per Owner Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {!ContentKeptEvents || ContentKeptEvents.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center">
                        No events found
                      </td>
                    </tr>
                  ) : (
                    ContentKeptEvents?.map((event, index) => {
                      return (
                        <tr key={index}>
                          <td className="text-center">
                            <Address address={event.args.buyer} />
                          </td>
                          <td>{event.args.contentId?.toString()}</td>
                          <td>{event.args.nonce?.toString()}</td>
                          <td>{parseFloat(formatEther(event.args.price || 0n)).toFixed(6)}</td>
                          <td>{event.args.referrer}</td>
                          <td>{parseFloat(formatEther(event.args.protocolPayment || 0n)).toFixed(6)}</td>
                          <td>{parseFloat(formatEther(event.args.referrerPayment || 0n)).toFixed(6)}</td>
                          <td>{parseFloat(formatEther(event.args.creatorPayment || 0n)).toFixed(6)}</td>
                          <td>{parseFloat(formatEther(event.args.perOwnerPayment || 0n)).toFixed(6)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isContentRefundedLoading ? (
          <div className="flex justify-center items-center mt-10">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : (
          <div className="mt-8 mb-8">
            <div className="text-center mb-4">
              <span className="block text-2xl font-bold">Content Refunded Events</span>
            </div>
            <div className="overflow-x-auto shadow-lg mb-5">
              <table className="table table-zebra w-full">
                <thead>
                  <tr>
                    <th className="bg-primary">Address</th>
                    <th className="bg-primary">Content ID</th>
                    <th className="bg-primary">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {!ContentRefundedEvents || ContentRefundedEvents.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center">
                        No events found
                      </td>
                    </tr>
                  ) : (
                    ContentRefundedEvents?.map((event, index) => {
                      return (
                        <tr key={index}>
                          <td className="text-center">
                            <Address address={event.args.buyer} />
                          </td>
                          <td>{event.args.contentId?.toString()}</td>
                          <td>{parseFloat(formatEther(event.args.amount || 0n)).toFixed(6)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isMinPriceUpdatedLoading ? (
          <div className="flex justify-center items-center mt-10">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : (
          <div className="mt-8">
            <div className="text-center mb-4">
              <span className="block text-2xl font-bold">Min Price Updated Events</span>
            </div>
            <div className="overflow-x-auto shadow-lg">
              <table className="table table-zebra w-full">
                <thead>
                  <tr>
                    <th className="bg-primary">Old Price</th>
                    <th className="bg-primary">New Price</th>
                  </tr>
                </thead>
                <tbody>
                  {!MinPriceUpdatedEvents || MinPriceUpdatedEvents.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-center">
                        No events found
                      </td>
                    </tr>
                  ) : (
                    MinPriceUpdatedEvents?.map((event, index) => {
                      return (
                        <tr key={index}>
                          <td>{parseFloat(formatEther(event.args.oldPrice || 0n)).toFixed(6)}</td>
                          <td>{parseFloat(formatEther(event.args.newPrice || 0n)).toFixed(6)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isRefundTimeLimitUpdatedLoading ? (
          <div className="flex justify-center items-center mt-10">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : (
          <div className="mt-8 mb-8">
            <div className="text-center mb-4">
              <span className="block text-2xl font-bold">Refund Time Limit Updated Events</span>
            </div>
            <div className="overflow-x-auto shadow-lg">
              <table className="table table-zebra w-full">
                <thead>
                  <tr>
                    <th className="bg-primary">Old Limit (seconds)</th>
                    <th className="bg-primary">New Limit (seconds)</th>
                  </tr>
                </thead>
                <tbody>
                  {!RefundTimeLimitUpdatedEvents || RefundTimeLimitUpdatedEvents.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="text-center">
                        No events found
                      </td>
                    </tr>
                  ) : (
                    RefundTimeLimitUpdatedEvents?.map((event, index) => {
                      return (
                        <tr key={index}>
                          <td>{event.args.oldLimit?.toString()}</td>
                          <td>{event.args.newLimit?.toString()}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isContentTypeAddedLoading ? (
          <div className="flex justify-center items-center mt-10">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : (
          <div className="mt-8">
            <div className="text-center mb-4">
              <span className="block text-2xl font-bold">Content Type Added Events</span>
            </div>
            <div className="overflow-x-auto shadow-lg">
              <table className="table table-zebra w-full">
                <thead>
                  <tr>
                    <th className="bg-primary">ID</th>
                    <th className="bg-primary">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {!ContentTypeAddedEvents || ContentTypeAddedEvents.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="text-center">
                        No events found
                      </td>
                    </tr>
                  ) : (
                    ContentTypeAddedEvents?.map((event, index) => {
                      return (
                        <tr key={index}>
                          <td>{event.args.id?.toString()}</td>
                          <td>{event.args.name}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isContentTypeUpdatedLoading ? (
          <div className="flex justify-center items-center mt-10">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : (
          <div className="mt-8 mb-8">
            <div className="text-center mb-4">
              <span className="block text-2xl font-bold">Content Type Updated Events</span>
            </div>
            <div className="overflow-x-auto shadow-lg">
              <table className="table table-zebra w-full">
                <thead>
                  <tr>
                    <th className="bg-primary">ID</th>
                    <th className="bg-primary">Name</th>
                    <th className="bg-primary">Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {!ContentTypeUpdatedEvents || ContentTypeUpdatedEvents.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-center">
                        No events found
                      </td>
                    </tr>
                  ) : (
                    ContentTypeUpdatedEvents?.map((event, index) => {
                      return (
                        <tr key={index}>
                          <td>{event.args.id?.toString()}</td>
                          <td>{event.args.name}</td>
                          <td>{event.args.enabled?.toString()}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default Events;
