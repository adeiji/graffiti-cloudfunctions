"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const GeoFire = require("geofire");
const main = require("./index");
const uuid = require("uuid/v1");
exports.tagWithGeoFire = function (snapshot, admin) {
    return __awaiter(this, void 0, void 0, function* () {
        // Tag the piece or spot with a location
        const piece = snapshot.data();
        const id = snapshot.id;
        const tagLocationReference = admin.database().ref('piece_locations');
        const geoFire = new GeoFire(tagLocationReference);
        const location = [piece.location.latitude, piece.location.longitude];
        main.handleIncrementDoc("tags", snapshot, 1).then(result => {
            geoFire.set(id, location).then(function () {
                console.log("Location saved with piece to database");
                return { success: "Location saved with piece to database" };
            }).catch(err => {
                return err;
            });
        }).catch(error => {
            return error;
        });
    });
};
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
function getUsersFromDocumentSnapshots(snapshots, db) {
    return __awaiter(this, void 0, void 0, function* () {
        var promises = [];
        snapshots.forEach(snapshot => {
            let query = db.collection("users").where("user_id", "==", snapshot.data().user_id).get();
            promises.push(query);
        });
        const userQuerySnapshots = yield Promise.all(promises);
        const documentWithUserInfo = main.getDocumentsToReturn(snapshots, userQuerySnapshots[0].docs);
        const promise = new Promise((resolve, reject) => {
            resolve(documentWithUserInfo);
        });
        return promise;
    });
}
exports.getDocumentsNearby = function (data, admin, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const currentLocation = {
            latitude: Number(data.latitude),
            longitude: Number(data.longitude)
        };
        const userId = data.user_id;
        const pageToken = data.page_token;
        let hashtags = data.hashtags;
        // If this is a HTTP Request than the hashtags will be sent as a string otherwise it's sent as an array
        if (res) {
            hashtags = data.hashtags.split(',');
        }
        const db = admin.firestore();
        if (!pageToken) {
            // Create a geo query that retrieves all the tags that are within a certain distance from the users current location
            try {
                const result = yield getTagsNearby(admin, currentLocation, db, userId, hashtags, 3, res);
                console.log("Result from getTagsNearby is: " + result);
                return result;
            }
            catch (error) {
                return error;
            }
        }
        else {
            try {
                const result = yield getTagsNearbyFromDatabase(pageToken, db, userId, pageToken, 3, res);
                console.log("Result from getTagsNearbyFromDatabase is " + result);
                return result;
            }
            catch (error) {
                return error;
            }
        }
    });
};
function removeSentTagsFromDatabase(idsToDeleteDocuments, db) {
    var batch = db.batch();
    idsToDeleteDocuments.forEach(document => {
        const docRef = db.collection("nearby_tags").doc(document.id);
        batch.delete(docRef);
    });
    batch.commit().then(function () {
        console.log("Tag Ids deleted from database that were already sent to the user or filtered");
    });
}
function getTagsNearbyFromDatabase(token, db, userId, hashtags, numberOfTagsToHandle, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const nearbyTagsRef = db.collection("nearby_tags");
        // Will return a list of tag ids
        return nearbyTagsRef.where("token", "==", token).get().limit(10)
            .then(tagSnapshot => {
            const tagIds = [];
            tagSnapshot.docs.forEach(tagIdDocument => {
                tagIds.push(tagIdDocument.data());
            });
            // If there's a token meaning we're paging, than only remove the documents that will be returned, otherwise remove all of them
            var tagsToRemove;
            if (token) {
                tagSnapshot.docs.split(numberOfTagsToHandle, tagSnapshot.docs.length - 1);
            }
            else {
                tagsToRemove = tagSnapshot.docs;
            }
            removeSentTagsFromDatabase(tagsToRemove, db);
            return handleTags(tagIds, db, userId, hashtags, token, numberOfTagsToHandle, res)
                .then(results => {
                return results;
            })
                .catch(err => {
                return err;
            });
        });
    });
}
function getTagsNearby(admin, currentLocation, db, userId, hashtags, numberOfTagsToHandle, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const pieceLocationRef = admin.database().ref('piece_locations');
        const geoFire = new GeoFire(pieceLocationRef);
        const currentGeoLocation = [currentLocation.latitude, currentLocation.longitude];
        const query = geoFire.query({
            center: currentGeoLocation,
            radius: 500
        });
        var keys = [];
        console.log("Current location in query is " + query.center());
        const keyEntered = query.on("key_entered", function (key, location, distance) {
            console.log("key: " + key + " location: " + location + " Distance from user: " + GeoFire.distance(currentGeoLocation, location));
            keys.push(key);
        });
        // This promise will wait for the "ready" event on the geoFire stream and return all the different tags that are nearby the user but are either from users this person follows or from
        // tags that the user follows
        const promise = new Promise((resolve, reject) => {
            query.on("ready", function () {
                console.log("Ready");
                // Sort our array by the distance to the user's current location
                keys = keys.sort((distance1, distance2) => {
                    if (distance1 > distance2) {
                        return 1;
                    }
                    else if (distance2 > distance1) {
                        return -1;
                    }
                    return 0;
                });
                // Only get the first 50 keys corresponding tags      
                query.cancel();
                return handleTags(keys, db, userId, hashtags, undefined, numberOfTagsToHandle, res)
                    .then(result => {
                    console.log("Result from handleTags function is: " + result);
                    resolve(result);
                })
                    .catch(err => {
                    reject(err);
                });
            });
        });
        return promise;
    });
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
function handleTags(allTagIds, db, userId, hashtags, token, numberOfTagsToHandle, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const followingUsers = yield getFollowing(userId, db);
        const tagIds = allTagIds.splice(0, numberOfTagsToHandle);
        const tagsSnapshot = yield getTags(tagIds, db);
        const tagsToReturn = [];
        console.log("The hashtags to filter by are :" + hashtags);
        console.log("The list of snapshots: " + tagsSnapshot);
        // Check to see if the tags match the tags the current user is following
        for (let counter = 0; counter < tagsSnapshot.length; counter++) {
            const tagSnapshot = tagsSnapshot[counter];
            const tag = tagSnapshot.data();
            tag["document_id"] = tagSnapshot.id;
            const spotHashtags = tag["hashtags"];
            console.log(tag);
            for (var i = 0; i < hashtags.length; i++) {
                if (followingUsers.indexOf(tag["user_id"]) !== -1) {
                    tagsToReturn.push(tagSnapshot);
                    break;
                }
                const hashtag = hashtags[i];
                console.log("Current checking if user is following hashtag: " + hashtag);
                // Get the subdocument representing the hashtags of the spot                  
                // Once we know this tag matches a hashtag the user follows than break the loop so we don't check all the rest of the hashtags as that's too time consuming
                if (spotHashtags[hashtag]) {
                    tagsToReturn.push(tagSnapshot);
                    break;
                }
            }
        }
        ;
        let myToken = token;
        if (!myToken) {
            myToken = uuid();
            storeNearbyTags(allTagIds.splice(numberOfTagsToHandle, allTagIds.length - 1), db, myToken);
        }
        console.log({ tags: tagsToReturn, token: myToken });
        const tagsWithUserInfo = yield getUsersFromDocumentSnapshots(tagsToReturn, db);
        console.log("Retrieved the tags with user information attached: " + tagsWithUserInfo);
        const promise = new Promise((resolve, reject) => {
            resolve({ tags: tagsWithUserInfo, token: myToken });
        });
        return promise;
    });
}
function storeNearbyTags(tagIds, db, token) {
    const batch = db.batch();
    tagIds.forEach(tagId => {
        const nearbyTagsRef = db.collection("nearby_tags").doc();
        batch.set(nearbyTagsRef, {
            token: token,
            tagId: tagId
        });
    });
    batch.commit().then(function () {
        console.log("Wrote tags nearby user to nearby_tags collection");
    });
}
/**
 * Get the tags corresponding to a list of tagIds
 *
 * @param {Array[String]} tagIds - The ids to get the tag documents for in the database
 * @param {Firebase Database Reference} db
 * @returns
 */
function getTags(tagIds, db) {
    return __awaiter(this, void 0, void 0, function* () {
        const tagCollectionRef = db.collection("tags");
        // Once we have all the documents using GeoFire, we need to retrieve their values from the respective collection, in this case from the Tags collections   
        const tagSnapshots = [];
        for (let i = 0; i < tagIds.length; i++) {
            const tagSnapshot = yield tagCollectionRef.doc(tagIds[i]).get();
            tagSnapshots.push(tagSnapshot);
            console.log("Pushed snapshot: " + tagSnapshot);
        }
        ;
        return tagSnapshots;
    });
}
// Get all the users that the current user is following
function getFollowing(userId, db) {
    return __awaiter(this, void 0, void 0, function* () {
        const relationshipRef = db.collection("relationships");
        const snapshot = yield relationshipRef.where("follower", "==", "userId").get();
        const following = [];
        snapshot.docs.forEach(document => {
            following.push(document);
        });
        return following;
    });
}
//# sourceMappingURL=locations.js.map