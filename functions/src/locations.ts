import * as GeoFire from "geofire"
import * as main from "./index"
import * as functions from "firebase-functions"
import * as uuid from "uuid/v1"
import * as notifications from "./notifications"
import { user } from "firebase-functions/lib/providers/auth";

export const deleteLocation = function (snapshot, admin) {
  const piece = snapshot.data()
  const id = snapshot.id
  const tagLocationReference = admin.database().ref('piece_locations')

  console.log("Id of piece: " + id)
  const geoFire = new GeoFire(tagLocationReference)
  return geoFire.remove(id).then(function () {
    console.log(id + " has been removed from GeoFire")
    return { success: id + " has been removed from GeoFire" }
  }).catch(err => {
    return err
  })
}

export const tagWithGeoFire = async function (snapshot, admin) {
  // Tag the piece or spot with a location
  const piece = snapshot.data()
  const id = snapshot.id
  const tagLocationReference = admin.database().ref('piece_locations')

  const geoFire = new GeoFire(tagLocationReference)
  const location = [piece.location.latitude, piece.location.longitude]

  main.handleIncrementDoc("tags", snapshot, 1).then(result => {
    geoFire.set(id, location).then(function () {
      console.log("Location saved with piece to database")
      return { success: "Location saved with piece to database" }
    }).catch(err => {
      setTimeout(function() {        
        geoFire.set(id, location)
          .then(function () {
            console.log("Location saved with pice to database")
            return { success: "Location saved with piece to database" }
            })
          .catch(error => {
            return error
          })
      }, 2000)
    })
  }).catch(error => {
    return error
  })
}

/**
 * Takes an array of Firebase snapshots and get's the users in relation to them and returns a promise containing JSON documents with the user information included
 * 
 * @param {any} documents - The Firebase Documents for which you want to get the User details for
 * 
 * @code
    db.collection("tags").get().then(snapshots => {
      getUsersFromDocumentsSnapshots(snapshots, db) 
    })
 */
async function getUsersFromDocumentSnapshots(snapshots, db) {
  console.log("getUsersFromDocumentSnapshots...")

  let promises:Promise<FirebaseFirestore.QuerySnapshot>[] = []
  snapshots.forEach(snapshot => {    
    let query = db.collection("users").where("user_id", "==", snapshot.data().user_id).get()
    console.log("spot user_id :" + snapshot.data().user_id)
    promises.push(query)
  });

  const userQuerySnapshots = await Promise.all(promises)
  let promise

  if (userQuerySnapshots.length != 0) {
    let userDocuments = userQuerySnapshots[0].docs  
    console.log("First user document: " + userDocuments)
    for (let index = 1; index < userQuerySnapshots.length; index++) {
      const snapshot = userQuerySnapshots[index];    
      userDocuments = userDocuments.concat(snapshot.docs)    
      console.log(snapshot.docs + " added to userDocuments array")
    }
    
    console.log("The userDocuments is: " + userDocuments.length)
    const documentWithUserInfo = main.getDocumentsToReturn(snapshots, userDocuments)
    promise = new Promise((resolve, reject) => {
      resolve(documentWithUserInfo)
    })    
  } else {
    promise = new Promise((resolve, reject) => {
      reject("The user does not exists anymore...")
    })
  }

  return promise
}

export const getDocumentsNearby = async function (data, admin, res) {
  const currentLocation = {
    latitude: Number(data.latitude),
    longitude: Number(data.longitude)
  }
  const userId = data.user_id
  const pageToken = data.page_token
  let hashtags = data.hashtags
  const isBackground = data.isBackground

  // If this is a HTTP Request than the hashtags will be sent as a string otherwise it's sent as an array
  if (res) {
    hashtags = data.hashtags.split(',')
  }

  const db = admin.firestore()

  if (!pageToken) {
    // Create a geo query that retrieves all the tags that are within a certain distance from the users current location
    try {
      const result = await getTagsNearby(admin, currentLocation, db, userId, hashtags, 100, res)
      console.log("The tags to return array length is " + result["tags"].length)
      console.log("isBackground = " + isBackground)
      if (isBackground == "true" && result["tags"].length > 0) {
        notifications.sendNotification(userId, "There's stuff nearby that you're interested in!", admin)
          .then(response => {
            console.log(response)
          })
          .catch(error => {
            console.log(error)
          })
      }
      console.log("Result from getTagsNearby is: " + result)
      return result
    } catch (error) {      
      return error
    }
  } else {
    try {
      const result = await getTagsNearbyFromDatabase(pageToken, db, userId, pageToken, 100, res)
      console.log("Result from getTagsNearbyFromDatabase is " + result)
      if (isBackground == "true" && result["tags"].length > 0) {
        notifications.sendNotification(userId, "There's stuff nearby that you're interested in!", admin)
          .then(response => {
            console.log(response)
          })
          .catch(error => {
            console.log(error)
          })
      }
      return result
    } catch (error) {
      return error
    }
  }
}

function removeSentTagsFromDatabase(idsToDeleteDocuments, db) {
  let batch = db.batch()
  idsToDeleteDocuments.forEach(document => {
    const docRef = db.collection("nearby_tags").doc(document.id)
    batch.delete(docRef)
  });

  batch.commit().then(function () {
    console.log("Tag Ids deleted from database that were already sent to the user or filtered")
  })
}

async function getTagsNearbyFromDatabase(token, db, userId, hashtags, numberOfTagsToHandle, res) {
  const nearbyTagsRef = db.collection("nearby_tags")
  // Will return a list of tag ids
  return nearbyTagsRef.where("token", "==", token).get().limit(10)
    .then(tagSnapshot => {
      const tagIds = []
      tagSnapshot.docs.forEach(tagIdDocument => {
        tagIds.push(tagIdDocument.data())
      });

      // If there's a token meaning we're paging, than only remove the documents that will be returned, otherwise remove all of them
      let tagsToRemove
      if (token) {
        tagSnapshot.docs.split(numberOfTagsToHandle, tagSnapshot.docs.length - 1)
      } else {
        tagsToRemove = tagSnapshot.docs
      }

      removeSentTagsFromDatabase(tagsToRemove, db)
      return handleTags(tagIds, db, userId, hashtags, token, numberOfTagsToHandle, res)
        .then(results => {
          return results
        })
        .catch(err => {
          return err
        })
    })
}

async function getTagsNearby(admin, currentLocation, db, userId, hashtags, numberOfTagsToHandle, res) {
  const pieceLocationRef = admin.database().ref('piece_locations')
  const geoFire = new GeoFire(pieceLocationRef)
  const currentGeoLocation = [currentLocation.latitude, currentLocation.longitude]
  const query = geoFire.query({
    center: currentGeoLocation,
    radius: 500
  })

  let keys = []
  console.log("Current location in query is " + query.center())

  const keyEntered = query.on("key_entered", function (key, location, distance) {
    console.log("key: " + key + " location: " + location + " Distance from user: " + GeoFire.distance(currentGeoLocation, location))
    keys.push(key)
  })

  // This promise will wait for the "ready" event on the geoFire stream and return all the different tags that are nearby the user but are either from users this person follows or from
  // tags that the user follows
  const promise = new Promise((resolve, reject) => {
    query.on("ready", function () {
      console.log("Ready")
      // Sort our array by the distance to the user's current location
      keys = keys.sort((distance1, distance2) => {
        if (distance1 > distance2) {
          return 1
        } else if (distance2 > distance1) {
          return -1
        }

        return 0
      })
      // Only get the first 50 keys corresponding tags      
      query.cancel()
      return handleTags(keys, db, userId, hashtags, undefined, numberOfTagsToHandle, res)
        .then(result => {
          console.log("Result from handleTags function is: " + result)
          resolve(result)
        })
        .catch(err => {
          reject(err)
        })
    })
  })

  return promise
}
/**
 * Returns all the tags that have a hashtag you follow or were created by users that you follow
 * 
 * @param {Array of Strings} allTagIds - A list of all the tag ids that are nearby the user
 * @param {Firebase database reference} db 
 * @param {string} userId 
 * @param {array of strings} hashtags 
 * @param {string} token 
 * @returns 
 */
async function handleTags(allTagIds, db, userId, hashtags, token, numberOfTagsToHandle, res) {
  const followingUsers = await getFollowing(userId, db)
  const tagIds = allTagIds.splice(0, numberOfTagsToHandle)
  const tagsSnapshot = await getTags(tagIds, db)
  const tagsToReturn = []

  console.log("The hashtags to filter by are :" + hashtags + "...")  
  // Check to see if the tags match the tags the current user is following
  for (let counter = 0; counter < tagsSnapshot.length; counter++) {
    const tagSnapshot = tagsSnapshot[counter]
    const tag = tagSnapshot.data()
    tag["document_id"] = tagSnapshot.id
    const spotHashtags = tag["hashtags"]
    console.log(tag)
    for (let i = 0; i < hashtags.length; i++) {
      if (followingUsers.indexOf(tag["user_id"]) !== -1) {
        tagsToReturn.push(tagSnapshot)
        break
      }
      const hashtag = hashtags[i]
      console.log("Currently checking if user is following hashtag: " + hashtag)
      // Get the subdocument representing the hashtags of the spot                  
      // Once we know this tag matches a hashtag the user follows than break the loop so we don't check all the rest of the hashtags as that's too time consuming
      if (spotHashtags[hashtag]) {        
        tagsToReturn.push(tagSnapshot)
        break
      }
    }
  };

  let myToken = token
  if (!myToken) {
    myToken = uuid()
    storeNearbyTags(allTagIds.splice(numberOfTagsToHandle, allTagIds.length - 1), db, myToken)
  }

  console.log({ tags: tagsToReturn, token: myToken })
  
  let tagsWithUserInfo = []
  if (tagsToReturn.length != 0) {
    tagsWithUserInfo = await getUsersFromDocumentSnapshots(tagsToReturn, db)
    console.log("Retrieved the tags with user information attached: " + tagsWithUserInfo)
  } 
  
  const promise = new Promise((resolve, reject) => {
    resolve({ tags: tagsWithUserInfo, token: myToken })
  })

  return promise
}

function storeNearbyTags(tagIds, db, token) {
  const batch = db.batch()
  tagIds.forEach(tagId => {
    const nearbyTagsRef = db.collection("nearby_tags").doc()
    batch.set(nearbyTagsRef, {
      token: token,
      tagId: tagId
    })
  })

  batch.commit().then(function () {
    console.log("Wrote tags nearby user to nearby_tags collection")
  })
}

/**
 * Get the tags corresponding to a list of tagIds
 * 
 * @param {Array[String]} tagIds - The ids to get the tag documents for in the database
 * @param {Firebase Database Reference} db 
 * @returns 
 */
async function getTags(tagIds, db) {
  const tagCollectionRef = db.collection("tags")

  // Once we have all the documents using GeoFire, we need to retrieve their values from the respective collection, in this case from the Tags collections     
  const promises = []

  for (let i = 0; i < tagIds.length; i++) {
    promises.push(tagCollectionRef.doc(tagIds[i]).get())        
  };

  const tagSnapshots = await Promise.all(promises)
  console.log(tagSnapshots)
  return tagSnapshots
}

// Get all the users that the current user is following
async function getFollowing(userId: string, db) {
  const relationshipRef = db.collection("relationships")
  const snapshot = await relationshipRef.where("follower", "==", userId).get()
  const following = []

  console.log("Ran query to get users that the current user is following...")  
  snapshot.docs.forEach(document => {
    following.push(document.data().followee)
  });

  console.log("Users the user is following: " + following)

  return following
}