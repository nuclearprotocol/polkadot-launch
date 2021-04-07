import Web3 from 'web3'

export async function readEveryBlock (web3:Web3,startingBlock:number){
    let currentBlockNumber=(await web3.eth.getBlock('latest')).number
    let maxNbTx=0
    let totalNbTx=0
    for(let i=startingBlock;i<=currentBlockNumber;i++){
        let block=await web3.eth.getBlock(i)
        let nbTx=block.transactions.length
        console.log('Block Number #',i," nb of tx :",nbTx)
        if (nbTx>maxNbTx){maxNbTx=nbTx}
        totalNbTx+=nbTx
    }
    console.log('Max number tx per block is ',maxNbTx)
    console.log('Total number tx is ',totalNbTx)
    return totalNbTx
}