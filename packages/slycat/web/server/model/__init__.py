# Copyright 2013, Sandia Corporation. Under the terms of Contract
# DE-AC04-94AL85000 with Sandia Corporation, the U.S. Government retains certain
# rights in this software.

import cherrypy
import h5py
import json
import numpy
import slycat.data.array
import slycat.data.hdf5
import slycat.web.server.database.couchdb
import slycat.web.server.database.hdf5
import slycat.web.server.spider
import sys
import threading
import time
import uuid

# Create a condition variable used to signal observers whenever a model is updated.
updated = threading.Condition()
# Keep track of model revisions
revision = 0
# Cache model ids
id_cache = set()

def database_monitor():
  database = slycat.web.server.database.couchdb.connect()

  # Initialize the cache ...
  global updated, revision, id_cache
  changes = database.changes(filter="slycat/models")
  with updated:
    revision = changes["last_seq"]
    for change in changes["results"]:
      if "deleted" in change:
        if change["id"] in id_cache:
          del id_cache[change["id"]]
      else:
        id_cache.add(change["id"])

  cherrypy.log.error("Initialized id cache to revision %s, loaded %s ids." % (revision, len(id_cache)))

  # Update the cache when the database changes ...
  while True:
    try:
      for change in database.changes(filter="slycat/models", feed="continuous", since=revision):
        with updated:
          if "deleted" in change:
            if change["id"] in id_cache:
              revision = change["seq"]
              updated.notify_all()
          elif "seq" in change:
            id_cache.add(change["id"])
            revision = change["seq"]
            updated.notify_all()
    except:
      cherrypy.log.error("Waiting to reconnect to database.")
      time.sleep(1.0)
      database = slycat.web.server.database.couchdb.connect()


def start_database_monitor():
  if start_database_monitor.thread is None:
    cherrypy.log.error("Starting database monitor.")
    start_database_monitor.thread = threading.Thread(name="Database Monitor", target=database_monitor)
    start_database_monitor.thread.daemon = True
    start_database_monitor.thread.start()
start_database_monitor.thread = None

def update(database, model, **kwargs):
  """Update the model, and signal any waiting threads that it's changed."""
  for name, value in kwargs.items():
    if name in ["state", "result", "started", "finished", "progress", "message"]:
      model[name] = value
  database.save(model)

def load_json_artifact(model, name):
  """Retrieve a json artifact from a model."""
  if model["artifact-types"][name] != "json":
    raise Exception("Not a json artifact.")
  return model["artifact:%s" % name]

def load_hdf5_artifact(model, name):
  """Retrieve an hdf5 artifact from a model."""
  if model["artifact-types"][name] not in ["hdf5"]:
    raise Exception("Not an hdf5 artifact.")
  return model["artifact:%s" % name]

def mix(a, b, amount):
  """Linear interpolation between two numbers.  Useful for computing model progress."""
  return ((1.0 - amount) * a) + (amount * b)

def copy_model_inputs(database, source, target):
  update(database, target, message="Copying existing model inputs.")
  for name in source["input-artifacts"]:
    original_type = source["artifact-types"][name]
    original_value = source["artifact:%s" % name]
    if original_type in ["json", "hdf5"]:
      target["artifact-types"][name] = original_type
      target["artifact:%s" % name] = original_value
      target["input-artifacts"] = list(set(target["input-artifacts"] + [name]))
    else:
      raise Exception("Cannot copy unknown input artifact type %s." & original_type)
  database.save(target)

def store_table_file(database, model, name, data, filename, nan_row_filtering, input=False):
  update(database, model, message="Loading table %s from %s." % (name, filename))
  tables = [perspective for perspective in slycat.web.server.spider.extract(type="table", content=data, filename=filename, nan_row_filtering=nan_row_filtering) if perspective["type"] == "table"]
  if len(tables) != 1:
    raise cherrypy.HTTPError("400 Uploaded file %s must contain exactly one table." % file.filename)
  table = tables[0]
  attributes = zip(table["column-names"], [slycat.data.array.attribute_type_map[type] for type in table["column-types"]])
  dimensions = [("row", "int64", 0, table["row-count"])]

  start_array_set(database, model, name, input)
  start_array(database, model, name, 0, attributes, dimensions)
  for attribute, data in enumerate(table["columns"]):
    store_array_attribute(database, model, name, 0, attribute, [(0, len(data))], data)

def store_parameter(database, model, name, value, input=False):
  model["artifact:%s" % name] = value
  model["artifact-types"][name] = "json"
  if input:
    model["input-artifacts"] = list(set(model["input-artifacts"] + [name]))
  database.save(model)

def store_file_artifact(database, model, name, value, content_type, input=False):
  fid = database.write_file(model, content=value, content_type=content_type)
  model = database[model["_id"]] # This is a workaround for the fact that put_attachment() doesn't update the revision number for us.
  model["artifact:%s" % name] = fid
  model["artifact-types"][name] = "file"
  if input:
    model["input-artifacts"] = list(set(model["input-artifacts"] + [name]))
  database.save(model)
  return model

def store_json_file_artifact(database, model, name, value, input=False):
  return store_file_artifact(database, model, name, json.dumps(value, separators=(",",":")), "application/json", input)

def start_array_set(database, model, name, input=False):
  """Start a model array set artifact."""
  update(database, model, message="Starting array set %s." % (name))
  storage = uuid.uuid4().hex
  with slycat.web.server.database.hdf5.create(storage) as file:
    database.save({"_id" : storage, "type" : "hdf5"})
    model["artifact:%s" % name] = storage
    model["artifact-types"][name] = "hdf5"
    if input:
      model["input-artifacts"] = list(set(model["input-artifacts"] + [name]))
    database.save(model)

def start_array(database, model, name, array_index, attributes, dimensions):
  update(database, model, message="Starting array set %s array %s." % (name, array_index))
  storage = model["artifact:%s" % name]

  with slycat.web.server.database.hdf5.open(storage, "r+") as file:
    slycat.data.hdf5.start_array(file, array_index, attributes, dimensions)

def store_array_attribute(database, model, name, array_index, attribute_index, ranges, data, byteorder=None):
  update(database, model, message="Storing array set %s array %s attribute %s." % (name, array_index, attribute_index))
  storage = model["artifact:%s" % name]
  with slycat.web.server.database.hdf5.open(storage, "r+") as file:
    array_metadata = slycat.data.hdf5.raw_array_metadata(file, array_index)
    stored_type = slycat.data.hdf5.dtype(array_metadata["attribute-types"][attribute_index])

    # Convert data to an array ...
    if isinstance(data, numpy.ndarray):
      pass
    elif isinstance(data, list):
      data = numpy.array(data, dtype=stored_type)
    else:
      if byteorder is None:
        data = numpy.array(json.load(data.file), dtype=stored_type)
      elif byteorder == sys.byteorder:
        data = numpy.fromfile(data.file, dtype=stored_type)
      else:
        raise NotImplementedError()

    slycat.data.hdf5.store_array_attribute(file, array_index, attribute_index, ranges, data)
